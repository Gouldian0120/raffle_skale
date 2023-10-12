const { networkConfig, development_chain } = require("../helper-hardhat-config");
const { network, ethers } = require("hardhat");
const { verify } = require("../utils/verify");

const VRF_MOCK_FEE = ethers.utils.parseEther("20");
const BASE_FEE = ethers.utils.parseEther("0.25"); // 0.25 premium , its cost 0.25 links
const GAS_PRICE_LINK = 1e9; // calculated based on gas price of chain link
const approveAmount = "0xfffffffffffffffffffffffffffff"

// const { ethers } = require("hardhat");

const sleep = async (seconds) => {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

const deploy = async (contractName, ...args) => {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...args);
  await contract.deployed();
  console.log("Deployed", contractName, contract.address);
  await verify(contract, args);
  return contract;
}

const verify = async (contract, args, retry = 3) => {
  if (["hardhat", "localhost"].includes(network.name)) return
  console.log("********************************************************")
  for (let i = 0; i < retry; i++) {
    try {
      await hre.run("verify:verify", {
        address: contract.address,
        constructorArguments: args,
      })
      break
    } catch (ex) {
      console.log("\t* Failed verify", args, ex.message)
      await sleep(5)
    }
  }
  console.log("********************************************************")
}

async function main() {
  
  const [deployer, alice, bob, clark, david] = await ethers.getSigners();

  const { deploy } = deployments;

  const chainId = network.config.chainId;
  const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

  [owner, player, collector] = await ethers.getSigners();

  console.log('chainId:', chainId);

  let 
    erc20Address = "", 
    erc721Address = "",
    usdtAddress = "";

  // for local only
  if (development_chain.includes(network.name)) {
    console.log("Local network is detected 🚀 deploying mock contracts");

    // deploy mock USDT
    if(!usdtAddress) {
      await deploy("USDTMock", {
        from: deployer.address,
        args: ['tUSDT', 'tUSDT', '6'],
        log: true,
      });
      console.log('USDT is deployed 👍');
    }
    
    // deploy mock ERC20
    if(!erc20Address) {
      await deploy("ERC20Mock", {
        from: deployer.address,
        args: ['MockErc20', 'MockErc20', '18'],
        log: true,
      });
      console.log('MockErc20 is deployed 👍');
    }

    // deploy mock ERC721
    if(!erc20Address) {
      await deploy("ERC721Mock", {
        from: deployer.address,
        args: [],
        log: true,
      });
      console.log('ERC721Mock is deployed 👍');
    }

    let usdt_mock_contract = await ethers.getContract("USDTMock");
    let erc20_mock_contract = await ethers.getContract("ERC20Mock");
    let erc721_mock_contraact = await ethers.getContract("ERC721Mock");

    usdtAddress = usdt_mock_contract.address; 
    erc20Address = erc20_mock_contract.address;
    erc721Address = erc721_mock_contraact.address;
    
  } // get from helper-hardhat-config.js
  else {
    usdtAddress = networkConfig[chainId].usdt_address;

    if(!usdtAddress) {
      // deploy mock USDT
      await deploy("USDTMock", {
        from: deployer.address,
        args: ['tUSDT', 'tUSDT', '6'],
        log: true,
        WaitForConfirmations: network.config.blockConfirmations || 1,
      });
      const usdt_mock_contract = await ethers.getContract("USDTMock");
      usdtAddress = usdt_mock_contract.address;
      console.log('USDT is deployed 👍');
    }
  }
  
  // deploy raffle contract

  const raffle_args = [
    usdtAddress,
    deployer.address
  ];

  const raffle = await deploy("Raffle", {
    from: deployer.address,
    args: raffle_args,
    log: true,
    WaitForconfimations: network.config.blockConfirmations || 1
  })
  console.log("Raffle is deployed 👍", await raffle.address);  
}

main()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
});
