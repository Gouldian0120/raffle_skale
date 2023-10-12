const { ethers } = require("hardhat");

const networkConfig = {
  31337: {
    name: "hardhat",
    entranceFee: ethers.utils.parseEther("0.01"),
    gaslane:
      "0x4b09e658ed251bcafeebbc69400383d49f344ace09b9576fe248bb02c003fe9f",
    callbackGasLimit: "500000",
    interval: "30",
    lottery: "",
    vrfCoordinator: "",
    subscriptionID: "",
    usdt_address: "",
  },
  1351057110: {
    name: "chaos",
    pricefeed_address: "",
    interval: "30", // 30 seconds,
    usdt_address: "",
    feeRecipient: ethers.constants.AddressZero,
  }
};

const development_chain = ["hardhat", "localhost"];
// const DECIMALS = 8;
// const INITIAL_ANSWER = 200000000000;

module.exports = { networkConfig, development_chain };
