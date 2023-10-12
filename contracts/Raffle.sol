// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./RNG.sol";
import "./interfaces/IRaffle.sol";
import "./interfaces/generic/IERC20.sol";
import "./libraries/Arrays.sol";
import "./libraries/Ownable.sol";
import "./libraries/ReentrancyGuard.sol";

contract Raffle is IRaffle, RNG, Ownable, ReentrancyGuard {
	using Arrays for uint256[];

    IERC20 public USDTInterface;

    /**
     * @notice The number of raffles created.
     */
    uint256 public rafflesCount;

    /**
     * @notice The raffles created.
     * @dev The key is the raffle ID.
     */
    mapping(uint256 => Raffle) public raffles;

    mapping(uint256 => mapping(address => ParticipantStats)) public rafflesParticipantsStats;

    /**
     * @notice It checks whether the currency is allowed.
     */
    mapping(address => bool) public isCurrencyAllowed;

    /**
     * @notice The maximum number of prizes per raffle.
     *         Each individual ERC-721 counts as one prize.
     *         Each ETH/ERC-20 with winnersCount > 1 counts as one prize.
     */
    uint256 public constant MAXIMUM_NUMBER_OF_PRIZES_PER_RAFFLE = 20;

    /**
     * @notice The maximum number of winners per raffle.
     */
    uint40 public constant MAXIMUM_NUMBER_OF_WINNERS_PER_RAFFLE = 2500;

    uint40 public constant SELECT_WINNERS_LIMIT = 1000;

    /**
     * @notice The fee recipient.
     */
    address public feeRecipient;

    uint40 public feePrice = 5e4; // fee is $0.05

    /**
     * @notice The number of pricing options per raffle.
     */
    uint256 public constant PRICING_OPTIONS_PER_RAFFLE = 5;

    /**
     * @param _feeRecipient The recipient of the fees
     * @param _usdtInterface The USDT address
     */
    constructor( address _usdtInterface, address _feeRecipient) {
        require(_usdtInterface != address(0), "Zero USDT Interface Address");

        if(_feeRecipient == address(0)) {
            _setFeeRecipient(msg.sender);
        } else {
            _setFeeRecipient(_feeRecipient);
        }

        USDTInterface = IERC20(_usdtInterface);
    }

    function createRaffle(CreateRaffleCalldata calldata params) external onlyOwner returns(uint256 raffleId) {
    	unchecked {
            raffleId = ++rafflesCount;
        }

        emit IncreaseRaffleId(raffleId);

        uint256 prizesCount = params.prizes.length;
        if (prizesCount == 0 || prizesCount > MAXIMUM_NUMBER_OF_PRIZES_PER_RAFFLE) {
            revert InvalidPrizesCount();
        }

        Raffle storage raffle = raffles[raffleId];

        uint40 cumulativeWinnersCount;
		uint8 currentPrizeTier;
		for(uint256 i = 0; i < prizesCount; i ++) {
			Prize memory prize = params.prizes[i];

			if(prize.prizeTier < currentPrizeTier) {
				revert InvalidPrize();
			}
			_validatePrize(prize);

			cumulativeWinnersCount += prize.winnersCount;
			prize.cumulativeWinnersCount = cumulativeWinnersCount;
			currentPrizeTier = prize.prizeTier;

			raffle.prizes.push(prize);
		}

		uint40 minimumEntries = params.minimumEntries;
		if (cumulativeWinnersCount > minimumEntries || cumulativeWinnersCount > MAXIMUM_NUMBER_OF_WINNERS_PER_RAFFLE) {
            revert InvalidWinnersCount();
        }

        _validateAndSetPricingOptions(raffleId, params.pricingOptions);

        raffle.owner = msg.sender;
        raffle.isMinimumEntriesFixed = params.isMinimumEntriesFixed;
        raffle.minimumEntries = minimumEntries;
        raffle.maximumEntriesPerParticipant = params.maximumEntriesPerParticipant;
        raffle.selectWinnersStartPosition = 0;

        _setRaffleStatus(raffle, raffleId, RaffleStatus.Open);
    }

    function enterRaffles(EntryCalldata[] calldata entries) external payable nonReentrant {
    	uint256 entriesCount = entries.length;
    	uint208 expectedUSDTValue;
    	uint256 userUSDTBalance = USDTInterface.allowance(msg.sender, address(this));

    	for (uint256 i = 0; i < entriesCount; i ++) {
    		EntryCalldata calldata entry = entries[i];

    		if (entry.pricingOptionIndex >= PRICING_OPTIONS_PER_RAFFLE) {
                revert InvalidIndex();
            }

            uint256 raffleId = entry.raffleId;
            Raffle storage raffle = raffles[raffleId];

            _validateRaffleStatus(raffle, RaffleStatus.Open);

            PricingOption memory pricingOption = raffle.pricingOptions[entry.pricingOptionIndex];

            uint40 newParticipantEntriesCount = rafflesParticipantsStats[raffleId][msg.sender].entriesCount + pricingOption.entriesCount;
            if (newParticipantEntriesCount > raffle.maximumEntriesPerParticipant) {
                revert MaximumEntriesPerParticipantReached();
            }
			rafflesParticipantsStats[raffleId][msg.sender].entriesCount = newParticipantEntriesCount;

			uint208 price = pricingOption.price;
			expectedUSDTValue += price;

			if (expectedUSDTValue > userUSDTBalance) {
				revert(string("Insufficient balance"));
			}
			
			uint40 currentEntryIndex;
			uint256 raffleEntriesCount = raffle.entries.length;
			if (raffleEntriesCount == 0) {
                currentEntryIndex = uint40(pricingOption.entriesCount - 1);
            } else {
                currentEntryIndex = raffle.entries[raffleEntriesCount - 1].currentEntryIndex + pricingOption.entriesCount;
            }

            if (raffle.isMinimumEntriesFixed) {
                if (currentEntryIndex >= raffle.minimumEntries) {
                    revert MaximumEntriesReached();
                }
            }

            raffle.entries.push(Entry({currentEntryIndex: currentEntryIndex, participant: msg.sender}));
            raffle.claimableFees += price;

            rafflesParticipantsStats[raffleId][msg.sender].amountPaid += price;

            emit EntrySold(raffleId, msg.sender, pricingOption.entriesCount, price);

            if (currentEntryIndex >= (raffle.minimumEntries - 1)) {
                _drawWinners(raffleId, raffle);
            }
    	}

    	USDTInterface.transferFrom(msg.sender, address(this), expectedUSDTValue);
    }

    function selectWinners(uint256 raffleId) external {
		Raffle storage raffle = raffles[raffleId];
		_validateRaffleStatus(raffle, RaffleStatus.Drawing);

        address raffleOwner = raffle.owner;
        if(msg.sender != raffleOwner) {
            _validateCaller(owner());
        }

		Prize[] storage prizes = raffle.prizes;
		uint256 prizesCount = prizes.length;
		uint256 winnersCount = prizes[prizesCount - 1].cumulativeWinnersCount;

		Entry[] memory entries = raffle.entries;
		uint256 entriesCount = entries.length;
		uint256 currentEntryIndex = uint256(entries[entriesCount - 1].currentEntryIndex);
        
        uint256[] memory currentEntryIndexArray = new uint256[](entriesCount);
		for (uint256 i = 0 ; i < entriesCount ; i ++) {
            currentEntryIndexArray[i] = entries[i].currentEntryIndex;
        }

        uint256[] memory cumulativeWinnersCountArray = new uint256[](prizesCount);
        for (uint256 i = 0 ; i < prizesCount; i ++) {
            cumulativeWinnersCountArray[i] = prizes[i].cumulativeWinnersCount;
        }

        uint40 cnt;
        uint256 j = raffle.selectWinnersStartPosition;

		for(j; j < winnersCount && cnt < SELECT_WINNERS_LIMIT; j ++) {
            uint256 winningEntry = getNextRandomNumber(j) % currentEntryIndex;
			raffle.winners.push(
				Winner({
					participant: entries[currentEntryIndexArray.findUpperBound(winningEntry)].participant,
					claimed: false,
					prizeIndex: uint8(cumulativeWinnersCountArray.findUpperBound(j + 1)),
					entryIndex: uint40(winningEntry)
				})
			);
            cnt ++;
		}

        raffle.selectWinnersStartPosition = j;
        if(raffle.selectWinnersStartPosition >= winnersCount)
		    _setRaffleStatus(raffle, raffleId, RaffleStatus.Drawn);
    }

    /**
     * @param raffleId The ID of the raffle to draw winners for.
     * @param raffle The raffle to draw winners for.
     */
    function _drawWinners(uint256 raffleId, Raffle storage raffle) private {
        _setRaffleStatus(raffle, raffleId, RaffleStatus.Drawing);
        raffle.drawnAt = uint40(block.timestamp);
    }

    function claimFees(uint256 raffleId) external nonReentrant() {
        Raffle storage raffle = raffles[raffleId];
        _validateRaffleStatus(raffle, RaffleStatus.Drawn);

        address raffleOwner = raffle.owner;
        if(msg.sender != raffleOwner) {
            _validateCaller(owner());
        }

        Entry[] memory entries = raffle.entries;
		uint256 entriesCount = entries.length;
		uint256 currentEntryIndex = uint256(entries[entriesCount - 1].currentEntryIndex);

        uint256 cliamableFee = raffle.claimableFees;
        uint256 protocolFees = feePrice * (currentEntryIndex + 1);

        require(USDTInterface.approve(address(this), cliamableFee), "USDT approve failed");

        cliamableFee = cliamableFee - protocolFees;

        USDTInterface.transferFrom(address(this), feeRecipient, protocolFees);
        USDTInterface.transferFrom(address(this), msg.sender, cliamableFee);

        raffle.claimableFees = 0;

        _setRaffleStatus(raffle, raffleId, RaffleStatus.Complete);

        emit FeesClaimed(raffleId, protocolFees + cliamableFee);
    }

    function updateCurrenciesStatus(address[] calldata currencies, bool isAllowed) external onlyOwner {
        uint256 count = currencies.length;
        for (uint256 i = 0 ; i < count; i ++) {
            isCurrencyAllowed[currencies[i]] = isAllowed;
        }
        emit CurrenciesStatusUpdated(currencies, isAllowed);
    }
    
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        _setFeeRecipient(_feeRecipient);
    }

    function setFeePrice(uint40 _feePrice) external onlyOwner {
        _setFeePrice(_feePrice);
    }

    function getWinners(uint256 raffleId) external view returns (Winner[] memory winners) {
        winners = raffles[raffleId].winners;
    }

    function getPrizes(uint256 raffleId) external view returns (Prize[] memory prizes) {
        prizes = raffles[raffleId].prizes;
    }

    function getEntries(uint256 raffleId) external view returns (Entry[] memory entries) {
        entries = raffles[raffleId].entries;
    }

    function getPricingOptions(uint256 raffleId) external view returns (PricingOption[PRICING_OPTIONS_PER_RAFFLE] memory pricingOptions) {
        pricingOptions = raffles[raffleId].pricingOptions;
    }

    function getSelectWinnersCurrentPosition(uint256 raffleId) external view returns (uint256 currentPosition) {
        currentPosition = raffles[raffleId].selectWinnersStartPosition;
    }

    function getWinnersCount(uint256 raffleId) external view returns (uint256 winnersCount) {
        require(raffleId > 0 && raffleId <= rafflesCount, "Invalid raffle ID");

        Raffle memory raffle = raffles[raffleId];
        Prize[] memory prizes = raffle.prizes;
		uint256 prizesCount = prizes.length;
		winnersCount = prizes[prizesCount - 1].cumulativeWinnersCount;
    }

    /**
     * @param raffleId The ID of the raffle.
     * @param pricingOptions The pricing options for the raffle.
     */
    function _validateAndSetPricingOptions(uint256 raffleId, PricingOption[PRICING_OPTIONS_PER_RAFFLE] calldata pricingOptions) private {
        for (uint256 i = 0 ; i < PRICING_OPTIONS_PER_RAFFLE; i ++) {
            PricingOption memory pricingOption = pricingOptions[i];

            uint40 entriesCount = pricingOption.entriesCount;
            uint208 price = pricingOption.price;

            if (entriesCount == 0 || price == 0) {
                revert InvalidPricingOption();
            }

            raffles[raffleId].pricingOptions[i] = pricingOption;
        }
    }

    /**
     * @param prize The prize.
     */
    function _validatePrize(Prize memory prize) private view {
        if (prize.prizeType == TokenType.ERC721) {
            if (prize.prizeAmount != 1 || prize.winnersCount != 1) {
                revert InvalidPrize();
            }
        } else {
            if (prize.prizeType == TokenType.ERC20) {
                if (!isCurrencyAllowed[prize.prizeAddress]) {
                    revert InvalidCurrency();
                }
            }

            if (prize.prizeAmount == 0 || prize.winnersCount == 0) {
                revert InvalidPrize();
            }
        }
    }

    /**
     * @param raffle The raffle to check the status of.
     * @param status The expected status of the raffle
     */
    function _validateRaffleStatus(Raffle storage raffle, RaffleStatus status) private view {
        if (raffle.status != status) {
            revert InvalidStatus();
        }
    }

    /**
     * @param caller The expected caller.
     */
    function _validateCaller(address caller) private view {
        if (msg.sender != caller) {
            revert InvalidCaller();
        }
    }

    /**
     * @param _feeRecipient The new fee recipient address
     */
    function _setFeeRecipient(address _feeRecipient) private {
        if (_feeRecipient == address(0)) {
            revert InvalidFeeRecipient();
        }
        feeRecipient = _feeRecipient;

        emit FeeRecipientUpdated(_feeRecipient);
    }

    function _setFeePrice(uint40 _feePrice) private {
        require(_feePrice > 0, "Invalid fee price");

        feePrice = _feePrice;

        emit FeePriceUpdated(_feePrice);
    }

    /**
     * @param raffle The raffle to set the status of.
     * @param raffleId The ID of the raffle to set the status of.
     * @param status The status to set.
     */
    function _setRaffleStatus(Raffle storage raffle, uint256 raffleId, RaffleStatus status) private {
        raffle.status = status;
        
        emit RaffleStatusUpdated(raffleId, status);
    }

}
