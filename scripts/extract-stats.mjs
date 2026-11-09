// The numbers the Codex shows beside a page's description: what a weapon does, how long a jetpack burns a fuel, what a
// vehicle burns, what a meal heals. Most come from the game's CommunityResources/Docs JSON and the game's own asset
// files (read with tools/map-extractor); the few the game doesn't hold come from the Satisfactory Wiki and are marked
// 'w' so the page can credit it. Writes src/data/stats.json: { id: [[key, value, unit, 'w'?], ...] }.
// Needs the game installed and the .NET SDK. Usage: bun scripts/extract-stats.mjs [game dir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GAME = process.argv[2] ?? process.env.SATISFACTORY_DIR ?? 'C:/Program Files/Epic Games/Satisfactory';
const dataDir = path.join(import.meta.dirname, '..', 'src', 'data');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ficsit-stats-'));
const en = JSON.parse(
  fs
    .readFileSync(path.join(GAME, 'CommunityResources', 'Docs', 'en-US.json'))
    .toString('utf16le')
    .replace(/^\uFEFF/, ''),
);
const doc = new Map(en.flatMap((g) => g.Classes.map((c) => [c.ClassName, c])));
const codex = JSON.parse(fs.readFileSync(path.join(dataDir, 'codex.json'), 'utf8'));
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---- The asset files to read ---------------------------------------------------
const F = 'FactoryGame/Content/FactoryGame/';
const EQUIP = {
  BP_EquipmentDescriptorRifle_C: 'Equipment/Rifle/Equip_Rifle',
  Desc_RebarGunProjectile_C: 'Equipment/RebarGun/Equip_RebarGun_Projectile',
  BP_EquipmentDescriptorNobeliskDetonator_C: 'Equipment/NobeliskDetonator/Equip_NobeliskDetonator',
  BP_EquipmentDescriptorStunSpear_C: 'Equipment/StunSpear/Equip_StunSpear',
  BP_EquipmentDescriptorShockShank_C: 'Equipment/ShockShank/Equip_ShockShank',
  BP_EquipmentDescriptorObjectScanner_C: 'Equipment/ObjectScanner/Equip_ObjectScanner',
  BP_EquipmentDescriptorHoverPack_C: 'Equipment/HoverPack/Equip_HoverPack',
  BP_EquipmentDescriptorJumpingStilts_C: 'Equipment/JumpingStilts/Equip_JumpingStilts',
  BP_EquipmentDescriptorHazmatSuit_C: 'Equipment/HazmatSuit/Equip_HazmatSuit',
  BP_EquipmentDescriptorGasmask_C: 'Equipment/GasMask/Equip_GasMask',
  BP_EqDescZipLine_C: 'Equipment/Zipline/Equip_Zipline',
  Desc_Parachute_C: 'Equipment/Parachute/Equip_Parachute',
};
const AMMO = {
  Desc_CartridgeStandard_C: 'Resource/Parts/CartridgeStandard/Desc_CartridgeStandard',
  Desc_CartridgeSmartProjectile_C: 'Equipment/Rifle/Ammo/Desc_CartridgeSmartProjectile',
  Desc_CartridgeChaos_C: 'Equipment/Rifle/Ammo/Desc_CartridgeChaos',
  Desc_SpikedRebar_C: 'Resource/Parts/SpikedRebar/Desc_SpikedRebar',
  Desc_Rebar_Explosive_C: 'Equipment/RebarGun/Ammo/Desc_Rebar_Explosive',
  Desc_Rebar_Stunshot_C: 'Equipment/RebarGun/Ammo/Desc_Rebar_Stunshot',
  Desc_Rebar_Spreadshot_C: 'Equipment/RebarGun/Ammo/Desc_Rebar_Spreadshot',
  Desc_NobeliskExplosive_C: 'Resource/Parts/NobeliskExplosive/Desc_NobeliskExplosive',
  Desc_NobeliskCluster_C: 'Equipment/NobeliskDetonator/Ammo/Desc_NobeliskCluster',
  Desc_NobeliskGas_C: 'Equipment/NobeliskDetonator/Ammo/Desc_NobeliskGas',
  Desc_NobeliskNuke_C: 'Equipment/NobeliskDetonator/Ammo/Desc_NobeliskNuke',
  Desc_NobeliskShockwave_C: 'Equipment/NobeliskDetonator/Ammo/Desc_NobeliskShockwave',
};
const VEHICLE = {
  Desc_Tractor_C: 'Buildable/Vehicle/Tractor/BP_Tractor',
  Desc_Truck_C: 'Buildable/Vehicle/Truck/BP_Truck',
  Desc_FluidTruck_C: 'Buildable/Vehicle/Truck/BP_FluidTruck',
  Desc_Explorer_C: 'Buildable/Vehicle/Explorer/BP_Explorer',
};
// What each creature's attack does lives in its blueprint (or, for hogs, the charge action it shares).
const C = 'Character/Creature/Enemy/';
const CREATURE = {
  Desc_HogBasic_C: 'Hog/Actions/BPCA_HogDefaultCharge',
  Desc_HogAlpha_C: 'Hog/AlphaHog/Char_AlphaHog',
  Desc_HogCliff_C: 'Hog/CliffHog/Char_CliffHog',
  Desc_HogNuclear_C: 'Hog/NuclearHog/Char_NuclearHog',
  Desc_SpitterDesert_Small_C: 'Spitter/SpitterDesert/Char_SpitterDesertSmall',
  Desc_SpitterAquatic_Small_C: 'Spitter/SpitterAquatic/Char_SpitterAquaticSmall',
  Desc_SpitterForest_Small_C: 'Spitter/SpitterForest/Char_SpitterForestSmall',
  Desc_SpitterForest_Small_Red_C: 'Spitter/SpitterForestRed/Char_SpitterForestRedSmall',
  Desc_SpitterDesert_Alpha_C: 'Spitter/SpitterDesert/Char_SpitterDesertAlpha',
  Desc_SpitterAquatic_Alpha_C: 'Spitter/SpitterAquatic/Char_SpitterAquaticAlpha',
  Desc_SpitterForest_Alpha_C: 'Spitter/SpitterForest/Char_SpitterForestAlpha',
  Desc_SpitterForest_Red_Alpha_C: 'Spitter/SpitterForestRed/Char_SpitterForestRedAlpha',
  Desc_StingerSmall_C: 'Stinger/SmallStinger/Char_Stinger_Child',
  Desc_StingerAlpha_C: 'Stinger/Char_Stinger',
  Desc_StingerElite_C: 'Stinger/BigStinger/Char_EliteStinger',
};
const FUELS = ['BioFuel', 'BioFuelLiquid', 'PlantFuel', 'TurboFuel', 'RocketFuel', 'IonizedFuel'].map(
  (n) => `Equipment/JetPack/FuelTypes/JFP_${n}`,
);
// Buildings: the ground a building takes is the main clearance box in its blueprint. Find each blueprint's file by its class name.
const buildable = new Map(
  execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, 'list', '/Build_'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split(/\r?\n/)
    .filter((l) => l.endsWith('.uasset'))
    .map((l) => [`${l.split('/').pop().replace('.uasset', '')}_C`, l]),
);
const BUILDINGS = Object.keys(codex.buildings).filter((id) => buildable.has(id));
const paths = [
  ...[...Object.values(EQUIP), ...Object.values(AMMO), ...Object.values(VEHICLE), ...FUELS].map((p) => `${F}${p}.uasset`),
  ...Object.values(CREATURE).map((p) => `${F}${C}${p}.uasset`),
  ...BUILDINGS.map((id) => buildable.get(id)),
];
const list = path.join(TMP, 'paths.txt');
const bulk = path.join(TMP, 'bulk.json');
fs.writeFileSync(list, paths.join('\n'));
execFileSync('dotnet', ['run', '--project', 'tools/map-extractor', '-c', 'Release', '--', GAME, 'bulk', list, bulk], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
const assets = JSON.parse(fs.readFileSync(bulk, 'utf8'));
const exportsOf = (p) => assets[`${F}${p}.uasset`] ?? assets[`${F}${C}${p}.uasset`] ?? [];
/** The properties of the asset's own default object (`Default__…`), or of the export with that name. */
const defaults = (p) => exportsOf(p).find((e) => e.Name?.startsWith('Default__'))?.Properties ?? {};
/** Damage types the asset carries: [{ type, amount, radius }]. */
const damages = (p) =>
  exportsOf(p)
    .filter((e) => /DamageType/.test(e.Type ?? '') && e.Properties?.mDamageAmount !== undefined)
    .map((e) => ({
      radial: /Radial/.test(e.Type),
      type: e.Type.replace(/^BP_(Point|Radial)DamageType_|_C$/g, ''),
      amount: e.Properties.mDamageAmount,
      radius: e.Properties.mDamageRadius,
    }));
const meters = (cm) => round(cm / 100, 1);

const stats = {};
const add = (id, key, value, unit = '', wiki) => {
  if (value === undefined || value === null || Number.isNaN(value)) return;
  stats[id] ??= [];
  stats[id].push(wiki ? [key, value, unit, 'w'] : [key, value, unit]);
};

// ---- Ammo -----------------------------------------------------------------------
for (const [id, p] of Object.entries(AMMO)) {
  const d = defaults(p);
  const hit = damages(p);
  const point = hit.find((x) => !x.radial);
  const radial = hit.find((x) => x.radial);
  const shots = d.mNumShots?.Max;
  add(id, 'damage', point?.amount ?? radial?.amount);
  if (point && radial) add(id, 'blastDamage', radial.amount);
  if (shots > 1) add(id, 'pellets', shots);
  if (d.mSpreadAngleDegrees) add(id, 'spread', d.mSpreadAngleDegrees, '°');
  if (radial) add(id, 'blastRadius', meters(radial.radius), 'm');
  // Rifle cartridges fire again and again; the rest are one shot per reload.
  if (/Cartridge/.test(id)) {
    const rate = 1 / Number(doc.get(id)?.mFireRate ?? d.mFireRate);
    add(id, 'fireRate', round(rate, 2), '/s');
    add(id, 'dps', round(point.amount * rate, 1), '/s');
  }
  const mag = Number(doc.get(id)?.mMagazineSize ?? d.mMagazineSize);
  if (mag > 1) add(id, 'magazine', mag);
  const range = Number(doc.get(id)?.mMaxAmmoEffectiveRange);
  if (range > 0 && /Cartridge|Rebar/.test(id)) add(id, 'range', meters(range), 'm');
}

// ---- Equipment ------------------------------------------------------------------
for (const [id, p] of Object.entries(EQUIP)) {
  const cls = p.split('/').pop();
  const g = doc.get(`${cls}_C`) ?? doc.get(cls) ?? {};
  const d = { ...g, ...defaults(p) };
  if (d.mReloadTime) add(id, 'reload', round(Number(d.mReloadTime), 2), 's');
  if (d.mMaxChargeTime && /Nobelisk/.test(id)) add(id, 'chargeTime', Number(d.mMaxChargeTime), 's');
  const hit = damages(p)[0];
  if (hit) add(id, 'damage', hit.amount);
  if (hit && d.mAttackDistance) add(id, 'reach', meters(Number(d.mAttackDistance)), 'm');
  if (d.mDetectionRange && /Scanner/.test(id)) add(id, 'scanRange', meters(Number(d.mDetectionRange)), 'm');
  if (d.mFilterDuration) add(id, 'filter', Number(d.mFilterDuration), 's');
  if (d.mSprintSpeedFactor) add(id, 'sprintBoost', Number(d.mSprintSpeedFactor), '×');
  if (d.mJumpSpeedFactor) add(id, 'jumpBoost', Number(d.mJumpSpeedFactor), '×');
  if (d.mHoverSpeed) {
    add(id, 'hoverSpeed', round(Number(d.mHoverSpeed) * 0.036, 1), 'km/h');
    add(id, 'hoverSprint', Number(d.mHoverSprintMultiplier), '×');
    add(id, 'power', Number(d.mPowerConsumption), 'MW');
    add(id, 'connectRange', meters(Number(d.mPowerConnectionSearchRadius)), 'm');
  }
  if (d.mZiplineJumpLaunchVelocity) add(id, 'launch', meters(Number(d.mZiplineJumpLaunchVelocity)), 'm/s');
}

// ---- Food and medicine: what one heals ------------------------------------------
for (const [id, it] of Object.entries(codex.items)) {
  const h = Number(doc.get(id)?.mHealthGain);
  if (it.kind === 'consumable' && h > 0) add(id, 'heals', h, 'HP');
}

// ---- Jetpack: how long one fuel item burns, from the fuel's burn rate ---------------
// The wiki lists the same burn times (solid biofuel 2.8 s ... ionized 7 s) and adds the flight time of a full tank
// with the thrust tapped for level flight, which the game files don't hold; those are marked as the wiki's.
const FLIGHT = {
  Desc_Biofuel_C: 12,
  Desc_Fuel_C: 17,
  Desc_TurboFuel_C: 23,
  Desc_PackagedBiofuel_C: 53,
  Desc_PackagedRocketFuel_C: 27.5,
  Desc_PackagedIonizedFuel_C: 60,
};
const jet = 'BP_EquipmentDescriptorJetPack_C';
for (const p of FUELS) {
  const ex = exportsOf(p).find((e) => e.Type === 'FGJetPackFuelParameters');
  const fuelId = ex?.Properties.mFuelTypeDesc?.ObjectName?.match(/'(\w+)'/)?.[1];
  if (!fuelId) continue;
  // The game leaves the burn rate off the default fuel; the wiki's 5 s for it is the engine default of 0.2 a second.
  const rate = ex.Properties.mFuelConsumeRate ?? 0.2;
  add(jet, `burn:${fuelId}`, round(1 / rate, 1), 's');
  if (FLIGHT[fuelId]) add(jet, `flight:${fuelId}`, FLIGHT[fuelId], 's', true);
}

// ---- Creatures: what one hit does, and the blast around it where there is one -------
for (const [id, p] of Object.entries(CREATURE)) {
  const hit = damages(p);
  const point = hit.find((x) => !x.radial);
  const radial = hit.find((x) => x.radial);
  add(id, 'damage', point?.amount ?? radial?.amount);
  if (point && radial) {
    add(id, 'blastDamage', radial.amount);
    add(id, 'blastRadius', meters(radial.radius), 'm');
  } else if (radial?.radius) add(id, 'blastRadius', meters(radial.radius), 'm');
}

// ---- Buildings: the ground one takes, width then length in metres --------------------
for (const id of BUILDINGS) {
  const boxes = exportsOf(buildable.get(id).replace(F, '').replace('.uasset', ''))
    .find((e) => e.Name?.startsWith('Default__'))
    ?.Properties?.mClearanceData?.filter((c) => c.Type.endsWith('CT_Default') && c.ClearanceBox.IsValid);
  if (!boxes?.length) continue;
  // A building is often several boxes (a Manufacturer's belt pit sits beside the machine): take them all, turned and moved.
  // A box turned off the grid or tipped over (the Particle Accelerator's) isn't ground the planner can count on: leave it out.
  const square = ({ Rotation: q }) => {
    const turns = (4 * Math.atan2(q.Z, q.W)) / Math.PI;
    return Math.abs(q.X) < 0.001 && Math.abs(q.Y) < 0.001 && Math.abs(turns - Math.round(turns)) < 0.01;
  };
  if (!boxes.every((c) => square(c.RelativeTransform))) continue;
  const xs = [];
  const ys = [];
  for (const { ClearanceBox: b, RelativeTransform: tr } of boxes) {
    const { Z: qz, W: qw } = tr.Rotation;
    for (const x of [b.Min.X, b.Max.X])
      for (const y of [b.Min.Y, b.Max.Y]) {
        // Only the turn around the vertical axis changes the ground a box covers.
        const yaw = 2 * Math.atan2(qz, qw) || 0;
        const rx = x * Math.cos(yaw) - y * Math.sin(yaw);
        const ry = x * Math.sin(yaw) + y * Math.cos(yaw);
        xs.push(rx + tr.Translation.X);
        ys.push(ry + tr.Translation.Y);
      }
  }
  const width = meters(Math.max(...xs) - Math.min(...xs));
  const length = meters(Math.max(...ys) - Math.min(...ys));
  // Rows hold [key, number, unit]; a footprint is the width with the length ("10") in the unit slot.
  if (width > 0 && length > 0) add(id, 'footprint', width, String(length));
}

// ---- Vehicles -------------------------------------------------------------------
for (const [id, p] of Object.entries(VEHICLE)) {
  const d = defaults(p);
  add(id, 'fuelUse', d.mManualFuelConsumption, 'MW');
}
// The Cyber Wagon's blueprint isn't in the files the planner reads; the wiki gives 150 MW.
add('Desc_CyberWagon_C', 'fuelUse', 150, 'MW', true);

fs.writeFileSync(path.join(dataDir, 'stats.json'), `${JSON.stringify(stats, null, 1)}\n`);
console.log(Object.keys(stats).length, 'pages with numbers');
for (const [id, s] of Object.entries(stats)) console.log(id, JSON.stringify(s));
