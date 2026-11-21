import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const config = JSON.parse(await fs.readFile(new URL('./bmc-revenue-inputs.json', import.meta.url), 'utf8'));
export function project(caseIndex = 1, overrides = {}) {
  const a = Object.fromEntries(config.drivers.map(d => [d.key, d.values[caseIndex]]));
  Object.assign(a, overrides);
  for (const [key, value] of Object.entries(a)) assert(Number.isFinite(value), `Missing/non-numeric assumption: ${key}`);
  for (const d of config.drivers.filter(d => d.format === 'pct')) assert(a[d.key] >= 0 && a[d.key] <= 1, `Invalid rate: ${d.key}`);
  assert(a.fbmMix + a.blackoutMix <= 1, 'First-party allocations exceed 100%');
  assert(a.serviceJobs <= 2, 'Service capacity exceeds two monthly projects');
  const rows = [];
  const digitalRate = (1-a.nativeShare)*a.cardRate+a.nativeShare*a.nativeRate;
  const digitalFixed = (1-a.nativeShare)*a.cardFixed;
  let cumulative = 0;
  for (let month=1; month<=12; month++) {
    const prev = rows.at(-1)?.active ?? 0;
    const active = month===1 ? a.audience*a.signup*a.activation : prev*(1+a.growth);
    const physicalOrders = month>=a.physicalStart ? active*a.physicalBuyers*a.physicalFrequency : 0;
    const physicalGmv = physicalOrders*a.physicalAov;
    const physicalProcessing = physicalGmv*a.cardRate+physicalOrders*a.cardFixed;
    const digitalOrders = month>=a.digitalStart ? active*a.digitalBuyers*a.digitalFrequency : 0;
    const digitalGmv = digitalOrders*a.digitalAov;
    const digitalProcessing = digitalGmv*digitalRate+digitalOrders*digitalFixed;
    const gameOrders = month>=a.gameStart ? active*a.gameBuyers*a.gameFrequency : 0;
    const gameGmv = gameOrders*a.gameAov;
    const gameProcessing = gameGmv*digitalRate+gameOrders*digitalFixed;
    const gmv = physicalGmv+digitalGmv+gameGmv;
    const processing = physicalProcessing+digitalProcessing+gameProcessing;
    const coalitionFee = (gmv-processing)*a.commission*(1-a.refund);
    const retainedFee = coalitionFee*a.retained;
    const sellerReceipts = gmv*(1-a.refund)-processing-coalitionFee;
    const eligibleNew = month===a.firstStart ? active : Math.max(0,active-prev);
    const firstUnits = month>=a.firstStart ? eligibleNew*a.firstNew+(month>a.firstStart?prev*a.firstRepeat:0) : 0;
    const fbmGross = firstUnits*a.fbmMix*a.fbmPrice;
    const blackoutGross = firstUnits*a.blackoutMix*a.blackoutPrice;
    const blackmaskGross = firstUnits*(1-a.fbmMix-a.blackoutMix)*a.blackmaskPrice;
    const firstGross = fbmGross+blackoutGross+blackmaskGross;
    const firstRevenue = firstGross*(1-a.refund);
    const firstProcessing = firstGross*digitalRate+firstUnits*digitalFixed;
    const storagePayers = month>=a.storageStart ? active*a.storageTake : 0;
    const storageGross = storagePayers*a.storagePrice;
    const storageRevenue = storageGross*(1-a.refund);
    const storageProcessing = storageGross*digitalRate+storagePayers*digitalFixed;
    const storageExpense = storagePayers*a.storageCost;
    const serviceJobs = month>=a.serviceStart ? a.serviceJobs : 0;
    const serviceGross = serviceJobs*a.servicePrice;
    const serviceRevenue = serviceGross*(1-a.refund);
    const serviceProcessing = serviceGross*a.cardRate+serviceJobs*a.cardFixed;
    const serviceExpense = serviceGross*a.serviceCost;
    const campaigns = month>=a.sponsorStart ? a.sponsorCount : 0;
    const sponsorGross = campaigns*a.sponsorFee;
    const sponsorRevenue = sponsorGross*(1-a.refund);
    const sponsorProcessing = sponsorGross*a.cardRate+campaigns*a.cardFixed;
    const restrictedBudget = campaigns*a.sponsorBudget;
    const payoutAccounts = gmv>0 ? Math.min(active*a.payoutShare,physicalOrders+digitalOrders+gameOrders) : 0;
    const connectExpense = payoutAccounts*(a.connectAccount+a.connectPayout)+sellerReceipts*a.connectRate;
    const lossExpense = gmv*a.lossRate;
    const variableExpense = active*a.variable;
    const ownedProcessing = firstProcessing+storageProcessing+serviceProcessing+sponsorProcessing;
    const revenue = retainedFee+firstRevenue+storageRevenue+serviceRevenue+sponsorRevenue;
    const expense = ownedProcessing+storageExpense+serviceExpense+connectExpense+lossExpense+variableExpense+a.fixed;
    const surplus = revenue-expense;
    cumulative += surplus;
    rows.push({month,active,netNew:active-prev,physicalOrders,physicalGmv,physicalProcessing,digitalOrders,digitalGmv,digitalProcessing,gameOrders,gameGmv,gameProcessing,gmv,processing,coalitionFee,retainedFee,sellerReceipts,eligibleNew,firstUnits,fbmGross,blackoutGross,blackmaskGross,firstGross,firstRevenue,firstProcessing,storagePayers,storageGross,storageRevenue,storageProcessing,storageExpense,serviceJobs,serviceGross,serviceRevenue,serviceProcessing,serviceExpense,campaigns,sponsorGross,sponsorRevenue,sponsorProcessing,restrictedBudget,payoutAccounts,connectExpense,lossExpense,variableExpense,ownedProcessing,revenue,expense,surplus,cumulative,economicSurplus:surplus-a.founderHours*a.founderRate,budgetGap:expense-a.budget});
  }
  const sum = key => rows.reduce((s,r)=>s+r[key],0);
  return {case:config.cases[caseIndex],assumptions:a,months:rows,annual:Object.fromEntries(Object.keys(rows[0]).filter(k=>!['month','active','netNew','cumulative','eligibleNew','budgetGap'].includes(k)).map(k=>[k,sum(k)])),averageActive:sum('active')/12,december:rows[11],peakFunding:Math.max(0,...rows.map(r=>-r.cumulative)),operatingBreakEven:rows.findIndex((r,i)=>r.surplus>=0&&rows.slice(i).every(x=>x.surplus>=0))+1};
}

export function unitEconomics(caseIndex = 1, overrides = {}) {
  const assumptions = Object.assign(Object.fromEntries(config.drivers.map(d => [d.key, d.values[caseIndex]])), overrides);
  const a = assumptions;
  const rate = (1-a.nativeShare)*a.cardRate+a.nativeShare*a.nativeRate;
  const fixed = (1-a.nativeShare)*a.cardFixed;
  const offer = (name,price,cost=0) => ({name,price,revenue:price*(1-a.refund),contribution:price*(1-a.refund)-price*rate-fixed-cost});
  const products = [offer('FBM enhancement',a.fbmPrice),offer('Blackout enhancement',a.blackoutPrice),offer('Blackmask enhancement',a.blackmaskPrice),offer('Blackmask storage',a.storagePrice,a.storageCost)];
  const steadyOverrides = {...overrides,audience:1000,signup:1,activation:1,growth:0,physicalStart:1,digitalStart:1,gameStart:1,firstStart:1,storageStart:1,serviceJobs:0,sponsorCount:0};
  const steady = project(caseIndex,steadyOverrides).december;
  const physical = project(caseIndex,{...steadyOverrides,digitalStart:13,gameStart:13,firstStart:13,storageStart:13}).december;
  const revenuePerActive = steady.revenue/1000;
  const variablePerActive = (steady.expense-a.fixed)/1000;
  const contributionPerActive = revenuePerActive-variablePerActive;
  const physicalFeeRate = physical.gmv>0?physical.retainedFee/physical.gmv:null;
  const physicalContributionRate = physical.gmv>0?(physical.surplus+a.fixed+1000*a.variable)/physical.gmv:null;
  return {assumptions,products,revenuePerActive,variablePerActive,contributionPerActive,
    breakEvenActive:contributionPerActive>0?Math.ceil(a.fixed/contributionPerActive):null,
    physicalFeeRate,physicalContributionRate,physicalContributionPerActive:(physical.surplus+a.fixed)/1000,
    revenueTargets:[250,1000,4000,10000].map(target=>({target,offers:products.map(p=>({name:p.name,units:Math.ceil(target/p.revenue)})),physicalGmv:physicalFeeRate>0?target/physicalFeeRate:null})),
    contributionTargets:[250,1000,4000,10000].map(target=>({target,offers:products.map(p=>({name:p.name,units:p.contribution>0?Math.ceil(target/p.contribution):null})),physicalGmv:physicalContributionRate>0?target/physicalContributionRate:null})),
    surplusTargets:[1000,4000,10000].map(target=>{const active=contributionPerActive>0?Math.ceil((target+a.fixed)/contributionPerActive):null;return {target,active,revenue:active===null?null:active*revenuePerActive,expense:active===null?null:a.fixed+active*variablePerActive,gmv:active===null?null:active*steady.gmv/1000};})};
}

export function verify() {
  const near=(x,y)=>assert(Math.abs(x-y)<1e-7,`${x} != ${y}`);
  for(let i=0;i<3;i++) for(const r of project(i).months) {
    near(r.gmv,r.processing+r.coalitionFee+r.sellerReceipts+r.gmv*config.drivers.find(d=>d.key==='refund').values[i]);
    near(r.firstGross,r.fbmGross+r.blackoutGross+r.blackmaskGross);
    near(r.revenue-r.expense,r.surplus);
    assert(r.coalitionFee>=0&&r.sellerReceipts>=0);
  }
  const zero=project(1,{audience:0,serviceJobs:0,sponsorCount:0});
  near(zero.annual.revenue,0); near(zero.annual.surplus,-3000);
  const delayed=project(1,{physicalStart:13,digitalStart:13,gameStart:13,firstStart:13,storageStart:13,serviceStart:13,sponsorStart:13});
  near(delayed.annual.revenue,0);
  const base=project();
  assert(project(1,{nativeRate:.30}).annual.surplus<base.annual.surplus);
  assert(project(1,{retained:.75}).annual.revenue<base.annual.revenue);
  assert(project(1,{gameStart:13}).annual.gameGmv===0);
  assert(project(1,{firstStart:13}).annual.firstRevenue===0);
  const units=unitEconomics();
  near(units.products[0].contribution,22.54375);
  near(units.products[3].contribution,2.668);
  for(const t of units.surplusTargets) {
    assert(t.revenue-t.expense>=t.target);
    assert((t.active-1)*units.contributionPerActive-base.assumptions.fixed<t.target);
  }
  assert.equal(unitEconomics(1,{variable:100}).breakEvenActive,null);
  return 'Verified: fee/refund/settlement reconciliation, first-party allocation, zero demand, unreleased streams, channel cost, retained-fee sensitivity, unit contribution and minimum target volumes.';
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const results=config.cases.map((_,i)=>project(i));
  const verification = verify();
  if(process.argv.includes('--json')) console.log(JSON.stringify({asOf:config.asOf,verification,results,unitEconomics:unitEconomics()},null,2));
  else {
    console.log(verification);
    console.log(JSON.stringify(results.map(p=>({case:p.case,annualRevenue:p.annual.revenue,annualSurplus:p.annual.surplus,annualGmv:p.annual.gmv,firstParty:p.annual.firstRevenue,commission:p.annual.retainedFee,storage:p.annual.storageRevenue,services:p.annual.serviceRevenue,sponsors:p.annual.sponsorRevenue,decActive:p.december.active,decRevenue:p.december.revenue,peakFunding:p.peakFunding,breakEvenMonth:p.operatingBreakEven})),null,2));
  }
}
