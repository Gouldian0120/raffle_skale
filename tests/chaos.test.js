// verbode tetsing

const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, network, ethers } = require("hardhat");
const {
  networkConfig,
  development_chain,
} = require("../helper-hardhat-config");
require('dotenv').config();

const chainID = network.config.chainId;
const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const nowTimestamp = Math.floor(new Date().getTime() / 1000);
const TokenType = {
  ERC721: 0,
  ERC20: 1,
};

describe("Raffle", function () {
  let raffle, usdt_mock_contract, erc20_mock_contract, erc721_mock_contract;
  let provider;
  let accounts, deployer, player, player2, feeRecipient;

  let raffleAddress = "0x639377c46777cD306EbD7E9e453406Ed08EDEa34",
      usdtAddress = "0xeef654418d2905988dfd382995b43ccec1150f8c",
      erc20Address = "0x1f89359326585a3415A8c4696765D876CF06B10f",
      erc721Address = "0x61F1793D5a08cFF297a49077E88844CB22c7bf02"

  beforeEach(async () => {
    // await deployments.fixture(); // deploy all contracts
    accounts = await getNamedAccounts();

    raffle = await ethers.getContractAt("LasmRaffle", raffleAddress);
    usdt_mock_contract = await ethers.getContractAt("USDTMock", usdtAddress);
    erc20_mock_contract = await ethers.getContractAt("ERC20Mock", erc20Address);
    erc721_mock_contract = await ethers.getContractAt("ERC721Mock", erc721Address);

    deployer = ethers.provider.getSigner(accounts.deployer);
    player = ethers.provider.getSigner(accounts.player);
    feeRecipient = ethers.provider.getSigner(accounts.feeRecipient);
    player2 = ethers.provider.getSigner(accounts.player2);
  });

  const showStatus = async () => {
    console.log();
    console.log("--- USDT Balance ---");
    console.log("      raffle: %s", ethers.utils.formatUnits(await usdt_mock_contract.balanceOf(raffle.address),6));
    console.log("    deployer: %s",ethers.utils.formatUnits(await usdt_mock_contract.balanceOf(accounts.deployer),6));
    console.log("      player: %s",ethers.utils.formatUnits(await usdt_mock_contract.balanceOf(accounts.player),6));
    console.log("feeRecipient: %s",ethers.utils.formatUnits(await usdt_mock_contract.balanceOf(accounts.feeRecipient),6));
  };

  describe("Raffle start", async () => {
    it("Check USDT balance", async () => {
      await usdt_mock_contract.approve(raffle.address, MAX_INT);
      await usdt_mock_contract.connect(player).approve(raffle.address, MAX_INT);
      await usdt_mock_contract.connect(player2).approve(raffle.address, MAX_INT);
      await usdt_mock_contract.transfer(accounts.player2, ethers.utils.parseUnits("500", 6));
      
      await showStatus();
    });

    it("Update currencies status in the Raffle contract", async () => {
      await raffle.updateCurrenciesStatus([usdt_mock_contract.address], true);
    });

    it("Set fee recipient address", async () => {
      await raffle.setFeeRecipient(accounts.feeRecipient);
    });

    it("Create Raffle", async () => {
      const prizes = [
        [1, 1, 0, 0, erc721_mock_contract.address, 1, 1], // NFT 1
        [1, 2, 0, 1, erc721_mock_contract.address, 2, 1], // NFT 1
        [1, 3, 0, 2, erc721_mock_contract.address, 3, 1], // NFT 1
        [10, 13, 1, 3, usdt_mock_contract.address, 0, ethers.utils.parseUnits("100", 6),], // usdt $100 * 1
        [40, 53, 1, 4, usdt_mock_contract.address, 0, ethers.utils.parseUnits("50", 6), ], // usdt $50 * 40
        [100, 153, 1, 4, usdt_mock_contract.address, 0, ethers.utils.parseUnits("25", 6), ], // usdt $25 * 100
        [750, 900, 1, 5, usdt_mock_contract.address, 0, ethers.utils.parseUnits("10", 6),], // usdt $10 * 750
        [1500, 2403, 1, 6, usdt_mock_contract.address, 0, ethers.utils.parseUnits("5", 6), ]]; // usdt $1 * 1500

      const pricingOptions = [
        [50, ethers.utils.parseUnits("17.5", 6)],
        [110, ethers.utils.parseUnits("35", 6)],
        [275, ethers.utils.parseUnits("87.5", 6)],
        [575, ethers.utils.parseUnits("175", 6)],
        [1200, ethers.utils.parseUnits("350", 6)],
      ];

      const args = {
        isMinimumEntriesFixed: false,
        minimumEntries: 3000,
        maximumEntriesPerParticipant: 1200,
        prizes: prizes,
        pricingOptions: pricingOptions,
      };

      const res = await raffle.createRaffle(args);
      await res.wait();

      const rafflesCount = await raffle.rafflesCount();
      expect(rafflesCount).equal(1);
    });

    it("Raffle status should be Open", async () => {
      const raffleId = await raffle.rafflesCount();
      let res = await raffle.raffles(raffleId);
      expect(res.status).to.equal(1);
    });
  });

  describe("Enter raffle", async () => {
    it("275 / $87.5 Enter raffle by player", async () => {
      const raffleId = await raffle.rafflesCount();

      const price = ethers.utils.parseUnits("87.5", 6);
      const args = [
        {
          raffleId: raffleId,
          pricingOptionIndex: 2,
        },
      ];

      const res = await raffle.connect(player).enterRaffles(args, { value: price });
      const ret = await res.wait();

      const { amountPaid, entriesCount, refunded } = await raffle.rafflesParticipantsStats(raffleId, accounts.player);

      expect(amountPaid).to.equal(price);
      expect(entriesCount).to.equal(275);
      expect(refunded).to.equal(false);
    });

    it("575 / $175 Enter raffle player", async () => {
      const raffleId = await raffle.rafflesCount();

      const price = ethers.utils.parseUnits("175", 6);
      const args = [
        {
          raffleId: raffleId,
          pricingOptionIndex: 3,
        },
      ];

      const res = await raffle.connect(player).enterRaffles(args, { value: price });
      const ret = await res.wait();

      const { amountPaid, entriesCount, refunded } = await raffle.rafflesParticipantsStats(raffleId, accounts.player);

      expect(amountPaid).to.equal(ethers.utils.parseUnits("262.5", 6));
      expect(entriesCount).to.equal(850);
      expect(refunded).to.equal(false);
    });

    it("1200 / $350 Enter raffle multiple by player2", async () => {
      const raffleId = await raffle.rafflesCount();

      const price = ethers.utils.parseUnits("350", 6);

      const args = [
        {
          raffleId: raffleId,
          pricingOptionIndex: 4,
        },
      ];

      let res = await raffle.connect(player2).enterRaffles(args, { value: price });
      let ret = await res.wait();

      const { amountPaid, entriesCount, refunded } = await raffle.rafflesParticipantsStats(raffleId, accounts.player2);

      expect(amountPaid).to.equal(price);
      expect(entriesCount).to.equal(1200);
      expect(refunded).to.equal(false);
    });

    it("1200 / $350 Enter raffle multiple by deployer", async () => {
      const raffleId = await raffle.rafflesCount();

      const price = ethers.utils.parseUnits("350", 6);

      const args = [
        {
          raffleId: raffleId,
          pricingOptionIndex: 4,
        },
      ];

      let res = await raffle.connect(deployer).enterRaffles(args, { value: price });
      let ret = await res.wait();

      const { amountPaid, entriesCount, refunded } = await raffle.rafflesParticipantsStats(raffleId, accounts.deployer);

      expect(amountPaid).to.equal(price);
      expect(entriesCount).to.equal(1200);
      expect(refunded).to.equal(false);
    });

    it("Total sold ticket amount should be 3250", async () => {
      const raffleId = await raffle.rafflesCount();
      let entries = await raffle.getEntries(raffleId);
      const currentEntryIndex = entries[entries.length - 1].currentEntryIndex;

      expect(currentEntryIndex).to.equal(3250);
    })

    it("show status", async () => {
      await showStatus();
    });
  });

  describe("Raffle Result", async () => {
    it("Raffle status should be drawing", async () => {
      const raffleId = await raffle.rafflesCount();

      let res = await raffle.raffles(raffleId);

      expect(res.status).to.equal(2);
    });

    it("Select winner", async () => {
      let res, ret;
      const raffleId = await raffle.rafflesCount();
      const winnersCount = await raffle.getWinnersCount(raffleId);
      expect(winnersCount).to.equal(2403);

      let selectWinnersCurrentPosition = 0;

      while(true) {
        selectWinnersCurrentPosition = await raffle.getSelectWinnersCurrentPosition(raffleId);
        if(selectWinnersCurrentPosition >= winnersCount) break;
        res = await raffle.selectWinners(raffleId, {gasLimit: 30000000});
        ret = await res.wait();
      }

      expect(selectWinnersCurrentPosition).to.equal(winnersCount);
    });

    it("Raffle status should be Drawn", async () => {
      const raffleId = await raffle.rafflesCount();
      res = await raffle.raffles(raffleId);

      expect(res.status).to.equal(3);
    });

    it("Get winners", async () => {
      let raffleId = await raffle.rafflesCount();
      let res = await raffle.getWinners(raffleId);
      expect(res.length).to.equal(2403);
    });

    it("Claim fee", async () => {
      let raffleId = await raffle.rafflesCount();
      let res = await raffle.claimFees(raffleId);
    });

    it("Raffle status should be Complete", async () => {
      let raffleId = await raffle.rafflesCount();
      let res = await raffle.raffles(raffleId);
      
      expect(res.status).to.equal(4);
    });
    
    it("show status", async () => {
      await showStatus();
    });
  });
});
