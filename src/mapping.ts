import { Address, BigDecimal, bigInt, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { FORT } from '../generated/MIMBond/FORT'
import { SFORT } from '../generated/MIMBond/SFORT'
import { JoePair } from '../generated/MIMBond/JoePair'
import { ERC20 } from '../generated/MIMBond/ERC20'
import { FortStacking } from '../generated/MIMBond/FortStacking'
import { DAO_ADDRESS, FORT_TIME_PAIR, MEMO_ADDRESS, MIM_ADDRESS, MIM_BOND_ADDRESS, MIM_TIME_BOND_ADDRESS, MIM_TIME_PAIR, STAKING_ADDRESS, TIME_ADDRESS, TREASURY_ADDRESS, WAVAX_ADDRESS, WAVAX_BOND_ADDRESS, WAVAX_TIME_BOND_ADDRESS, WAVAX_USDC_PAIR } from './constants';
import { ProtocolMetric } from '../generated/schema'

const POW_9 = BigInt.fromI32(10).pow(9).toBigDecimal();

export function updateProtocolMetrics(event: ethereum.Event): void{
    let metrics = loadOrCreateProtocolMetrics(event.block.timestamp);

    metrics.timestamp = event.block.timestamp;
    metrics.blockNumber = event.block.number
    metrics.totalSupply = getTotalSupply()
    metrics.ohmCirculatingSupply = getFortCirculatingSupply(metrics.totalSupply)
    metrics.sOhmCirculatingSupply = getSFortCirculatingSupply()
    metrics.ohmPrice = getFORTPrice();
    metrics.marketCap = metrics.ohmCirculatingSupply.times(metrics.ohmPrice)
    metrics.totalValueLocked = metrics.sOhmCirculatingSupply.times(metrics.ohmPrice)
    metrics.ownedLiquidity = getOwnedLiquidity()
    metrics.totalLiquidity = getLiquidity()

    const mvRfv = getMvRfv();
    metrics.treasuryMarketValue = mvRfv[0]
    metrics.treasuryRiskFreeValue = mvRfv[1]
    metrics.treasuryMIMMarketValue = mvRfv[2]
    metrics.treasuryWAVAXMarketValue = mvRfv[3]
    metrics.treasuryFORTMIMMarketValue = mvRfv[4]
    metrics.treasuryFORTAVAXMarketValue = mvRfv[5]
    metrics.treasuryMIMRiskFreeValue = mvRfv[6]    
    metrics.treasuryFORTMIMRiskFreeValue = mvRfv[7]    
    metrics.treasuryFORTAVAXRiskFreeValue = mvRfv[8]    

    metrics.apy = getCurrentAPY();

    metrics.save()
}

function getCurrentAPY(): BigDecimal
{
    const staking = FortStacking.bind(Address.fromString(STAKING_ADDRESS)).epoch();
    const sFort = SFORT.bind(Address.fromString(MEMO_ADDRESS));
    let circ = toDecimal(sFort.circulatingSupply(), 9);
    const stakingReward = toDecimal(staking.value1, 9)

    if (circ.lt(stakingReward) || circ.equals(stakingReward)) {
        return BigDecimal.fromString("0");
    }

    const stakingRebase = stakingReward.div(circ)
    const stakingRebaseNumber = Number.parseFloat(stakingRebase.toString())

    log.debug("staking reward : {}", [stakingReward.toString()])
    log.debug("circ : {}", [circ.toString()])
    log.debug("staking rebase : {}", [stakingRebaseNumber.toString()])

    const stakingAPY = Math.pow(stakingRebaseNumber + 1, 365 * 3) - 1;

    return BigDecimal.fromString(stakingAPY.toString()).times(BigDecimal.fromString("100"))
}

function getLiquidity(): BigDecimal {
    const pair = JoePair.bind(Address.fromString(MIM_TIME_PAIR));
    const totalSupply = pair.totalSupply();
    return getPairUSD(totalSupply, MIM_TIME_PAIR);
}

function getOwnedLiquidity(): BigDecimal {
    const pair = ERC20.bind(Address.fromString(MIM_TIME_PAIR));
    const total = pair.totalSupply().toBigDecimal()
    const balance = pair.balanceOf(Address.fromString(TREASURY_ADDRESS)).toBigDecimal()
    return balance.div(total).times(BigDecimal.fromString("100"))
}

function getMvRfv(): BigDecimal[] {
    const treasuryAddress = Address.fromString(TREASURY_ADDRESS)

    const mim = ERC20.bind(Address.fromString(MIM_ADDRESS));
    const mimValue = toDecimal(mim.balanceOf(treasuryAddress), 18);

    const wavax = ERC20.bind(Address.fromString(WAVAX_ADDRESS));
    const wavaxBalance = toDecimal(wavax.balanceOf(treasuryAddress), 18);
    const wavaxValue = wavaxBalance.times(getAVAXPrice());

    const mimFort = ERC20.bind(Address.fromString(MIM_TIME_PAIR));
    const mimFortBalance = mimFort.balanceOf(treasuryAddress)
    const mimFortValue = getPairUSD(mimFortBalance, MIM_TIME_PAIR)
    const mimFortRiskFreeValue = getDiscountedPairUSD(mimFortBalance, MIM_TIME_PAIR)

    const avaxFort = ERC20.bind(Address.fromString(FORT_TIME_PAIR));
    const avaxFortBalance = avaxFort.balanceOf(treasuryAddress)
    const avaxFortValue = getPairUSD(avaxFortBalance, FORT_TIME_PAIR)
    const avaxFortRiskFreeValue = getDiscountedPairUSD(avaxFortBalance, FORT_TIME_PAIR)

    return [
        mimValue.plus(wavaxValue).plus(mimFortValue),
        mimValue.plus(mimFortRiskFreeValue),
        mimValue,
        wavaxValue,
        mimFortValue,
        avaxFortValue,
        mimValue,
        mimFortRiskFreeValue,
        avaxFortRiskFreeValue
    ];
}

export function getDiscountedPairUSD(lp_amount: BigInt, pair_adress: string): BigDecimal{
    let pair = JoePair.bind(Address.fromString(pair_adress))

    let total_lp = pair.totalSupply()
    let lp_token_2 = toDecimal(pair.getReserves().value0, 9)
    let lp_token_1 = toDecimal(pair.getReserves().value1, 18)
    let kLast = lp_token_1.times(lp_token_2).truncate(0).digits

    let part1 = toDecimal(lp_amount,18).div(toDecimal(total_lp,18))
    let two = BigInt.fromI32(2)

    let sqrt = kLast.sqrt();
    let part2 = toDecimal(two.times(sqrt), 0)
    let result = part1.times(part2)
    return result
}

function getPairUSD(amount: BigInt, address: string): BigDecimal {
    const pair = JoePair.bind(Address.fromString(address));

    const totalLP = pair.totalSupply();
    const reserves = pair.getReserves();
    const reserve0 = reserves.value0
    const reserve1 = reserves.value1
    const ownedLP = toDecimal(amount, 18).div(toDecimal(totalLP, 18))
    const fortValue = toDecimal(reserve1, 9).times(getFORTPrice())
    const totalLPUSD = fortValue.plus(toDecimal(reserve0, 18))

    return ownedLP.times(totalLPUSD)
}

function getFORTPrice(): BigDecimal {
    const reserves = JoePair.bind(Address.fromString(MIM_TIME_PAIR)).getReserves();

    const reserve0 = reserves.value0.toBigDecimal()
    const reserve1 = reserves.value1.toBigDecimal()

    return reserve0.div(reserve1).div(POW_9);
}

function getAVAXPrice(): BigDecimal {
    const reserves = JoePair.bind(Address.fromString(WAVAX_USDC_PAIR)).getReserves();

    const reserve0 = toDecimal(reserves.value0, 6)
    const reserve1 = toDecimal(reserves.value1, 18)

    return reserve0.div(reserve1)
}

function getFortCirculatingSupply(totalSupply: BigDecimal): BigDecimal {
    const fort = FORT.bind(Address.fromString(TIME_ADDRESS))
    const daoBalance = toDecimal(fort.balanceOf(Address.fromString(DAO_ADDRESS)), 9)
    const mimBondBalance = toDecimal(fort.balanceOf(Address.fromString(MIM_BOND_ADDRESS)), 9)
    const wavaxBondBalance = toDecimal(fort.balanceOf(Address.fromString(WAVAX_BOND_ADDRESS)), 9)
    const fortMimBondBalance = toDecimal(fort.balanceOf(Address.fromString(MIM_TIME_BOND_ADDRESS)), 9)
    const fortAvaxBondBalance = toDecimal(fort.balanceOf(Address.fromString(WAVAX_TIME_BOND_ADDRESS)), 9)

    return totalSupply
        .minus(daoBalance)
        .minus(mimBondBalance)
        .minus(wavaxBondBalance)
        .minus(fortMimBondBalance)
        .minus(fortAvaxBondBalance)
}

function getSFortCirculatingSupply(): BigDecimal {
    return toDecimal(SFORT.bind(Address.fromString(MEMO_ADDRESS)).circulatingSupply(), 9);
}

function getTotalSupply(): BigDecimal {
    return toDecimal(FORT.bind(Address.fromString(TIME_ADDRESS)).totalSupply(), 9);
}

function toDecimal(val: BigInt, decimals: number): BigDecimal {
    const pow = BigInt.fromString("10").pow(<u8>decimals).toBigDecimal();
    return val.divDecimal(pow);
}

function loadOrCreateProtocolMetrics(ts: BigInt): ProtocolMetric {
    const day = dayFromTimestamp(ts);
    let metrics = ProtocolMetric.load(day);
    if (metrics !== null) {
        return metrics;
    }
    metrics = new ProtocolMetric(day);
    metrics.save();
    return metrics;
}

function dayFromTimestamp(ts: BigInt): string {
    return (ts.toI32() - (ts.toI32() % 86400)).toString();
}