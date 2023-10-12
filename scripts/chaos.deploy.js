// require("@nomiclabs/hardhat-waffle");
// require("@nomiclabs/hardhat-etherscan");

const hre = require("hardhat");

const sleep = async (seconds) => {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
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
  const { deploy } = deployments;
  const {deployer} = await getNamedAccounts();
  let usdtAddress = "";

  /**
   * For test net
   */
  // Deploy mock usdt
  const usdt_args = ['tUSDT', 'tUSDT', 6];
  
  const usdt = await deploy("USDTMock", 
    {
        from: deployer,
        args: usdt_args,
        log: true,
    }
  );

  console.log("USDT is deployed 👍", usdt.address);
  await verify(usdt, usdt_args);

  usdtAddress = usdt.address;

  // Deploy mock ERC721
  const erc721 = await deploy("ERC721Mock", 
      {
          from: deployer,
          args: [],
          log: true,
      }
  );

  console.log('erc721:', erc721.address);
  await verify(erc721, []);

  // Deploy mock ERC20
  const erc20_args = [
    'MockErc20', 'MockErc20', 18
  ]
  
  const erc20 = await deploy("ERC20Mock", 
      {
          from: deployer,
          args: erc20_args,
          log: true,
      }
  );

  console.log('erc20:',erc20.address);
  await verify(erc20, erc20_args);

  // Deploy Raffle contract
  const raffle_args = [
    usdtAddress,
    deployer
  ];

  const raffle = await deploy("Raffle", 
      {
          from: deployer,
          args: raffle_args,
          log: true,
      }
  );

  console.log("Raffle is deployed 👍", raffle.address);
  await verify(raffle, raffle_args);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
