const Web3 = require("web3");
const request = require('request');
const DB = require("./db.js");
const express = require('express')
const bodyParser = require("body-parser");
const app = express()
const port = 3000

const contractABI = require("./erc20abi.json")
const koffeeSwapRouterABI = require("./koffeeswaprouter.json")
const koffeeSwapFactoryABI = require("./koffeeswapfactory.json")
const fs = require('fs');

const koffeeSwapRouterAddr = "0xc0fFee0000C824D24E0F280f1e4D21152625742b"
const koffeeSwapFactoryAddr = "0xC0fFeE00000e1439651C6aD025ea2A71ED7F3Eab"
const kuSwapRouterAddr = "0xA58350d6dEE8441aa42754346860E3545cc83cdA"
const kuSwapFactoryAddr = "0xAE46cBBCDFBa3bE0F02F463Ec5486eBB4e2e65Ae"

const KCS_DECIMALS = 18

let web3 = new Web3(new Web3.providers.WebsocketProvider("wss://rpc-ws-mainnet.kcc.network", {
    clientConfig: {
        maxReceivedFrameSize: 10000000000,
        maxReceivedMessageSize: 10000000000
    }
}))

const kuSwapRouter = new web3.eth.Contract(koffeeSwapRouterABI, kuSwapRouterAddr)

const koffeeSwapRouter = new web3.eth.Contract(koffeeSwapRouterABI, koffeeSwapRouterAddr)
const koffeeSwapfactory = new web3.eth.Contract(koffeeSwapFactoryABI, koffeeSwapFactoryAddr)
const db = DB.getInstance();

async function fetchContractInfo(contractAddress) {
    let tokenContract = new web3.eth.Contract(contractABI, contractAddress)
    let decimal = await tokenContract.methods.decimals().call()
    let tokenName = await tokenContract.methods.name().call()
    let tokenSymbol = await tokenContract.methods.symbol().call()
    return { name: tokenName, symbol: tokenSymbol, decimal, address: contractAddress }
}

async function fetchListOfContractInfo(contractAddressList) {
    const contractsPromises = contractAddressList.map((c) => {
        return fetchContractInfo(c)
    })
    return await Promise.all(contractsPromises)
}

async function populateContractDB(contractInfo) {
    let promises = []
    if(Array.isArray(contractInfo)) {
        for(const info of contractInfo) {
            promises.push(db.set("contracts", info.address.toLowerCase(), info));
        }
    } else {
        promises.push(db.set("contracts", info.address.toLowerCase(), contractInfo));
    }
    await Promise.all(promises);
}

async function getContractInfoFromDB(contractAddress) {
    return db.get("contracts", contractAddress.toLowerCase())
}

async function getTokenBalanceFromContract(contractAddress, walletAddress, router) {
    try {
        let contractInfo = await getContractInfoFromDB(contractAddress)
        let tokenContract = new web3.eth.Contract(contractABI, contractAddress)
        let balance = await tokenContract.methods.balanceOf(walletAddress).call()
        let adjustedBalance = balance / Math.pow(10, contractInfo.decimal)
        let adjustedAmountOut = 0
        if (balance > 0) {
            let wkcsAddress = await router.methods.WKCS().call()
            let wkcsContract = new web3.eth.Contract(contractABI, wkcsAddress)
            let amountOut = await router.methods.getAmountsOut(balance, [contractAddress, wkcsAddress]).call()
            let wkcsDecimal = await wkcsContract.methods.decimals().call()
            adjustedAmountOut = amountOut[1] / Math.pow(10, wkcsDecimal)
        }

        return { adjustedBalance, tokenName: contractInfo.name, tokenSymbol: contractInfo.symbol, adjustedAmountOut }
    } catch (e) {
        console.log(e)
    }
}

async function getKCSPrice() {
    let r = await new Promise((resolve, reject) => {
        request("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=kucoin-shares", { json: true }, (err, res, body) => {
            if (err) {
                reject(err)
                return
            }
            resolve(res.toJSON())
        })
    })
    return r.body[0].current_price
}


async function getValues(addresses) {

    const KCSprice = await getKCSPrice()
    let totalKCS = 0
    let addressInfo = {}
    for (const walletAddress of addresses) {
        let walletKCSBalance = await web3.eth.getBalance(walletAddress) / Math.pow(10, KCS_DECIMALS)
        addressInfo[walletAddress] = {
            "tokens": [],
            "balance": walletKCSBalance
        }
        const promises = Object.keys(await db.getAll("contracts")).map((c) => {
            return getTokenBalanceFromContract(c, walletAddress, koffeeSwapRouter)
        })

        const tokenBalanceFromContracts = await Promise.all(promises)
        for (const resultInfo of tokenBalanceFromContracts) {
            if (resultInfo.adjustedAmountOut > 0) {
                addressInfo[walletAddress]["tokens"].push(resultInfo)
                walletKCSBalance += resultInfo.adjustedAmountOut
            }
        }
        addressInfo[walletAddress]["worthKCS"] = walletKCSBalance
        addressInfo[walletAddress]["worthUSD"] = walletKCSBalance * KCSprice
        totalKCS += walletKCSBalance
    }

    addressInfo["combined"] = {
        KCSPrice: KCSprice,
        worthKCS: totalKCS,
        worthUSD: totalKCS * KCSprice
    }

    return addressInfo
}

async function addContract(contract) {
    let contractInfo
    try {
    if(Array.isArray(contract)) {
        contractInfo = await fetchListOfContractInfo(contract)
    } else {
        contractInfo = await fetchContractInfo(contract)
    }
    } catch(e) {
        console.log(e)
    }
    await populateContractDB(contractInfo)
}

async function syncWithChain() {
    koffeeSwapfactory.events.PairCreated({
        fromBlock:0,
        toBlock: 'latest'
    }, function(error, events) { }).on('data',async function(event){
        let tokenAddr = ""
        if(event.returnValues.token0.toLowerCase() !== "0x4446Fc4eb47f2f6586f9fAAb68B3498F86C07521".toLowerCase()) {
            tokenAddr = event.returnValues.token0;
        } else {
            tokenAddr = event.returnValues.token1;
        }
        await addContract([tokenAddr])
    })
}

async function main() {
    const addresses = require("./addresses.json")
    const contracts = require("./contracts.json")
    // await syncWithChain();
    // await addContract(contracts)
    const info = await getValues(addresses)
    console.log(info)
    fs.writeFileSync("./info.json", JSON.stringify(info, null, 2))
}


app.get('/', async (req, res) => {
    if(req.query.address) {
        res.send(await getValues(req.query.address))
    } else {
        res.send({});
    }
})

app.get('/sync', async (req, res) => {
    await syncWithChain();
    res.send("SYNC");
})
  
app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
})
