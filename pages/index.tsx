import { useCallback, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { NextPage } from 'next'
import {
  convertViemChainToRelayChain,
  createClient,
  MAINNET_RELAY_API,
} from '@reservoir0x/relay-sdk'
import {
  useAccount,
  useBalance,
  useConfig,
  useReadContract,
  useWalletClient,
  useWatchBlocks,
} from 'wagmi'
import { berachain, mainnet } from 'viem/chains'
import { Address, encodeFunctionData, createPublicClient, formatUnits, parseUnits, http } from 'viem'
import { switchChain } from 'wagmi/actions'
import { depositRelayerContract } from '../lib/depositRelayerContract'
import { berachainUsdcContract } from '../lib/berachainUsdcContract'
import { ethereumUsdcContract } from '../lib/ethereumUsdcContract'

import { useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { getCurrentStepDescription } from '../lib/getCurrentStepDescription'

const relayClient = createClient({
  baseApiUrl: MAINNET_RELAY_API,
  chains: [
    convertViemChainToRelayChain(berachain),
    convertViemChainToRelayChain(mainnet),
  ],
  pollingInterval: 1000,
})

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
})

function getTransferCalldata(usdcAmount: string): string {
  // Ensure the amount is in the right format (USDC has 6 decimals)
  const amountInWei = parseUnits(usdcAmount, 6);
  // Encode the approve function calldata
  const calldata = encodeFunctionData({
    abi: ethereumUsdcContract.abi, // ABI of the USDC contract
    functionName: 'transfer',
    args: [depositRelayerContract.address as Address, amountInWei],
  })
  console.log("TRANSFER: ", calldata);
  return calldata
}        

function getDepositCalldata(user: Address, usdcAmount: string, originChainId: bigint, referrer: Address): string {
  // Ensure the amount is in the right format (USDC has 6 decimals)
  const amountInWei = parseUnits(usdcAmount, 6);
  // Encode the approve function calldata
  const calldata = encodeFunctionData({
    abi: depositRelayerContract.abi,
    functionName: 'handleRelayLinkDeposit',
    args: [ethereumUsdcContract.address as Address, amountInWei, user, originChainId, referrer], // Assumes referrer is user themselves
  })
  console.log("DEPOSIT: ", calldata);
  return calldata
}

const Home: NextPage = () => {
  const { address, chain: activeChain } = useAccount()
  const { data: wallet } = useWalletClient()
  const wagmiConfig = useConfig()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<string | undefined>()

  const [usdcAmount, setUsdcAmount] = useState('');

  const { data: berachainBalance, queryKey: berachainBalanceQueryKey } =
    useBalance({
      address,
      chainId: berachain.id,
    })

  const { data: berachainUsdcBalance, queryKey: berachainUsdcBalanceQueryKey } =
    useReadContract({
      // ...berachainUsdcContract,
      address: berachainUsdcContract.address as Address,
      abi: berachainUsdcContract.abi,
      functionName: 'balanceOf',
      chainId: berachain.id,
      args: [address as Address],
      query: {
        enabled: address !== undefined,
      },
    })

  useWatchBlocks({
    onBlock() {
      queryClient.invalidateQueries({ queryKey: berachainBalanceQueryKey })
      queryClient.invalidateQueries({ queryKey: berachainUsdcBalanceQueryKey })
    },
  })
  //
  const deposit = useCallback(async () => {
    if (!wallet || !address) {
      console.error('Missing wallet')
      return
    }
    try {
      // Make sure user is on the Origin Chain (Berachain)
      if (activeChain?.id !== berachain.id) {
        await switchChain(wagmiConfig, {
          chainId: berachain.id,
        })
      }
      console.log(berachainUsdcBalance);
      setStep('Getting quote for deposit')
      
      const transferCallData = getTransferCalldata(usdcAmount)
      const depositCallData = getDepositCalldata(address, usdcAmount, BigInt(berachain.id), address)

      const quote = await relayClient.actions.getQuote({
        wallet,
        chainId: berachain.id, // The chain id to call from
        toChainId: mainnet.id, // The chain id to call to
        amount: parseUnits(usdcAmount, 6).toString(),
        currency: berachainUsdcContract.address,
        toCurrency: ethereumUsdcContract.address,
        tradeType: 'EXACT_OUTPUT',
        txs: [
          {
            to: ethereumUsdcContract.address,
            value:  "0",
            data: transferCallData
          },
          {
            to: depositRelayerContract.address,
            value:  "0",
            data: depositCallData
          }
        ]
      });
      console.log(quote);
      await relayClient.actions.execute({
        quote,
        wallet,
        // onProgress: (steps, currentStep, currentStepItem, fees, details, txHashes) => {
        //   console.log(steps, currentStep, currentStepItem, fees, details, txHashes)
        // }
      })
    } catch (e) {
      throw e
    }
  }, [wallet, address, wagmiConfig, activeChain, usdcAmount])

  return (
    <main className="flex flex-col items-center gap-4 py-[100px]">
      <ConnectButton />
      <div className="flex  gap-x-20">
        <div className="flex flex-col">
          <Image
            src={
              'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOCIgaGVpZ2h0PSIyOCI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48cGF0aCBmaWxsPSIjMDA1MkZGIiBmaWxsLXJ1bGU9Im5vbnplcm8iIGQ9Ik0xNCAyOGExNCAxNCAwIDEgMCAwLTI4IDE0IDE0IDAgMCAwIDAgMjhaIi8+PHBhdGggZmlsbD0iI0ZGRiIgZD0iTTEzLjk2NyAyMy44NmM1LjQ0NSAwIDkuODYtNC40MTUgOS44Ni05Ljg2IDAtNS40NDUtNC40MTUtOS44Ni05Ljg2LTkuODYtNS4xNjYgMC05LjQwMyAzLjk3NC05LjgyNSA5LjAzaDE0LjYzdjEuNjQySDQuMTQyYy40MTMgNS4wNjUgNC42NTQgOS4wNDcgOS44MjYgOS4wNDdaIi8+PC9nPjwvc3ZnPg'
            }
            alt="Ethereum"
            width={30}
            height={30}
          />
          <p className="font-bold underline">Berachain</p>

          <p>Bera Balance: {formatUnits(berachainBalance?.value || 0n, 18)}</p>
          <p>Bera USDC Balance: {formatUnits(berachainUsdcBalance as bigint|| 0n, 6)}</p>
          {activeChain?.id === berachain.id ? (
            <p className="text-green-500">Connected</p>
          ) : null}
        </div>
      </div>
      <input
        type="number"
        value={usdcAmount}
        onChange={(e) => setUsdcAmount(e.target.value)}
        placeholder="Enter USDC amount"
        className="border px-3 py-2 rounded-md text-center"
      />      
      <p>{step}</p>
      <button
        onClick={deposit}
        disabled={!address}
        className="bg-blue-500 py-2 px-4 rounded-md text-white"
      >
        Deposit
      </button>
    </main>
  )
}

export default Home
