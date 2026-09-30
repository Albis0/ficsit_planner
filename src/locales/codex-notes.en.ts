/**
 * "Good to know" notes on Codex pages: what the game files don't say, written for players. Keyed by item or
 * building id. Paragraphs are separated by a blank line.
 */
export const ITEM_NOTES: Record<string, string> = {
  Desc_IronScrew_C:
    'Screws are cheap but go into so much that they’re often the busiest line in an early factory. Two alternates cut them down: Cast Screw makes them straight from iron ingots and skips the rods, and Steel Screw turns one steel beam into 52.',
  Desc_IronPlateReinforced_C:
    'Needed for Modular Frames, Smart Plating and a long list of buildings. The standard recipe eats screws; Stitched Iron Plate uses wire instead and Adhered Iron Plate rubber, and Bolted Iron Plate makes three times as many in one assembler.',
  Desc_ModularFrame_C:
    'Modular Frames go into Heavy Modular Frames, Versatile Framework and most mid-game buildings, so a steady line of them is worth building before you need it.',
  Desc_ModularFrameHeavy_C:
    'One of the hungriest parts of the mid game: the standard recipe needs 120 screws for each frame. Heavy Encased Frame drops the screws for concrete and encased beams.',
  Desc_SteelIngot_C:
    'Steel needs coal next to the iron ore, so steel works go where both are close. Solid Steel Ingot (iron ingots and coal) and Compacted Steel Ingot (iron ore and compacted coal) get more steel from the same coal.',
  Desc_Cement_C:
    'Plain concrete is limestone and nothing else, at three to one. Wet Concrete, Fine Concrete and Rubber Concrete get much more out of the same limestone.',
  Desc_Wire_C: 'Copper wire runs everything electric. Fused Wire and Caterium Wire make several times as much wire per ingot.',
  Desc_Silica_C:
    'Alumina Solution leaves silica behind, enough for part of what the aluminum ingots need; count it before building a separate silica line.',
  Desc_AluminumIngot_C:
    'The aluminum chain goes through the refinery twice. The scrap step gives water back, which can go straight into the next batch of alumina solution.',
  Desc_AluminaSolution_C:
    'Leaves silica as well; the aluminum ingots take it. Alumina Solution is a fluid, so it moves in pipes, or packed in canisters.',
  Desc_Plastic_C:
    'Made in a refinery from crude oil, leaving heavy oil residue. Residual Plastic makes more from the polymer resin that fuel leaves, and Recycled Plastic turns rubber and fuel into plastic.',
  Desc_Rubber_C:
    'Like plastic: crude oil in, heavy oil residue left over. Residual Rubber uses the polymer resin fuel leaves behind, and Recycled Rubber turns plastic and fuel into rubber.',
  Desc_HeavyOilResidue_C:
    'Left over from plastic and rubber. A refinery stops when a byproduct has nowhere to go, so take it away: Residual Fuel turns it into fuel, and Petroleum Coke into fuel for coal generators.',
  Desc_PolymerResin_C:
    'Left over from fuel. With water, Residual Plastic and Residual Rubber turn it into plastic and rubber. If nothing uses it, sink it so the refinery keeps running.',
  Desc_LiquidFuel_C: 'Burns in Fuel-Powered Generators. Packed in canisters it can ride belts, trains and trucks, and fuels vehicles.',
  Desc_LiquidOil_C:
    'From Oil Extractors on oil nodes, or from resource wells. Refineries turn it into plastic, rubber and fuel, each leaving a byproduct that needs a place to go.',
  Desc_Water_C:
    'The only resource with no limit. Water Extractors go on any open water deep enough. Each coal generator drinks 45 m³ a minute and each nuclear plant 240.',
  Desc_Coal_C:
    'Coal runs the first real power and the first steel. A Coal-Powered Generator burns 15 a minute, so a normal node with a Miner Mk.2 keeps eight of them going.',
  Desc_Sulfur_C:
    'Goes into black powder, compacted coal, batteries and rocket fuel. Sulfur nodes are rare, so check the map before planning big.',
  Desc_OreUranium_C:
    'Radioactive: carrying it or standing near it hurts without a Hazmat Suit. It becomes Uranium Fuel Rods for Nuclear Power Plants.',
  Desc_NuclearWaste_C:
    'Can’t be sunk and never breaks down. Store it somewhere safe, or turn it into Non-Fissile Uranium and then plutonium fuel rods.',
  Desc_PlutoniumWaste_C:
    'What plutonium fuel rods leave. It only goes into Ficsonium, whose fuel rods leave nothing behind, which closes the nuclear chain.',
  Desc_NuclearFuelRod_C: 'Each rod runs a Nuclear Power Plant for five minutes at 2,500 MW and leaves 50 uranium waste.',
  Desc_CrystalShard_C:
    'Each shard in a building adds 50% to its top speed, up to three per building for 250%. They come from power slugs in a Constructor, or as Synthetic Power Shards late in the game.',
  Desc_Crystal_C: 'A blue power slug gives one power shard.',
  Desc_Crystal_mk2_C: 'A yellow power slug gives two power shards.',
  Desc_Crystal_mk3_C: 'A purple power slug gives five power shards.',
  Desc_WAT1_C:
    'A full set in a production building doubles its output for four times the power. Somersloops also pay for MAM research and the Alien Power Augmenter, and there’s a fixed number on the map.',
  Desc_WAT2_C: 'Spent in the MAM on alien research, and on Dimensional Depot upgrades.',
  Desc_HardDrive_C: 'Found at crash sites. Scanning one in the MAM offers a choice of alternate recipes.',
  Desc_Leaves_C: 'Picked by hand or with the chainsaw; no building makes it.',
  Desc_Wood_C: 'Cut with the chainsaw; no building makes it.',
  Desc_Mycelia_C: 'Picked by hand from the ground; no building makes it.',
  Desc_GenericBiomass_C:
    'The first power in the game, burned in Biomass Burners. Everything that goes into it is picked or hunted, so it’s a stopgap until coal.',
  Desc_Biofuel_C: 'Burns longer than biomass, and it’s what the chainsaw runs on.',
  Desc_FluidCanister_C:
    'Unpacking a packaged fluid gives the canister back, so a packaging line can run in a loop with only a few new canisters.',
  Desc_GasTank_C: 'Like canisters, for gases. Unpacking gives the tank back.',
  Desc_NitrogenGas_C: 'Only from resource wells: a Resource Well Pressurizer powers the field and extractors sit on its nodes.',
  Desc_Battery_C: 'Leaves water behind, which can go back into the sulfuric acid. Batteries also fuel drones.',
  Desc_Computer_C: 'Needs plastic, so it comes after oil. Supercomputers and the late Space Elevator parts depend on it.',
  Desc_SpaceElevatorPart_1_C: 'The first Space Elevator part, from the Assembler. The first phase takes only 50.',
  Desc_PackagedWater_C: 'Water in a canister, for belts and trains. Unpack it where it’s needed.',
  Desc_TurboFuel_C: 'Packed turbofuel: fuel for vehicles and the jetpack.',
  Desc_CompactedCoal_C:
    'Coal pressed with sulfur. It burns longer than coal in a Coal-Powered Generator and goes into turbofuel and Compacted Steel Ingot.',
  Desc_PetroleumCoke_C:
    'Made from heavy oil residue. Burns in Coal-Powered Generators, and Coke Steel Ingot makes steel with it instead of coal.',
  Desc_SAM_C: 'The Converter uses it to turn one raw resource into another, and it goes into the alien late-game parts.',
  Desc_Diamond_C: 'Made in the Particle Accelerator. Several alternates make more diamonds from the same coal.',
};

export const BUILDING_NOTES: Record<string, string> = {
  Build_SmelterMk1_C: 'One ore in, one ingot out. Smelters draw only 4 MW, so they’re cheap to overclock.',
  Build_ConstructorMk1_C: 'One input, one output. The most common building in almost any factory.',
  Build_AssemblerMk1_C: 'Two inputs, one output: plates, frames, rotors, circuit boards and most of the mid game.',
  Build_FoundryMk1_C: 'Two solid inputs: steel, aluminum and the alloy ingots.',
  Build_ManufacturerMk1_C:
    'Up to four inputs. At 55 MW it’s the first building where overclocking costs add up fast, and getting four belts into it takes some planning.',
  Build_OilRefinery_C:
    'Takes and gives both solids and fluids. Many of its recipes leave a byproduct, and it stops when that byproduct has nowhere to go.',
  Build_Packager_C: 'Puts fluids in canisters and tanks and takes them out again, so fluids can travel by belt, train and truck.',
  Build_Blender_C: 'Up to four inputs, fluids and solids, for the late-game chemistry: batteries, cooling systems, nitric acid.',
  Build_HadronCollider_C:
    'Its power draw swings over every cycle, from the low figure to the high one. Size the grid for the peak, not the average, or the fuses trip.',
  Build_Converter_C: 'Turns one raw resource into another with SAM. Its power swings over each cycle like the Particle Accelerator’s.',
  Build_QuantumEncoder_C: 'The last production building. Its power swings over each cycle, so leave room on the grid for the peak.',
  Build_MinerMk1_C: 'Sits on a solid resource node. Output depends on the node’s purity: half on impure, double on pure.',
  Build_MinerMk2_C: 'Twice the Mk.1. On a pure node at 100% it already needs a Mk.3 belt.',
  Build_MinerMk3_C: 'On a pure node at 250% it digs 1,200 a minute, which takes a Mk.6 belt to carry.',
  Build_WaterPump_C: 'Goes anywhere on water deep enough. Always 120 m³ a minute at 100%, with no purity.',
  Build_OilPump_C: 'Sits on an oil node. Like miners, its output depends on the node’s purity.',
  Build_GeneratorBiomass_Automated_C: 'The first generator. Feed it by hand or by belt; everything it burns is picked or hunted.',
  Build_GeneratorCoal_C: 'Needs water as well as fuel: 45 m³ a minute each. Burns coal, compacted coal or petroleum coke.',
  Build_GeneratorFuel_C: 'Burns fuel, turbofuel, liquid biofuel, rocket fuel or ionized fuel. No water needed.',
  Build_GeneratorNuclear_C: '2,500 MW each, but it needs 240 m³ of water a minute and leaves radioactive waste that has to go somewhere.',
  Build_GeneratorGeoThermal_C:
    'Built on a geyser and needs no fuel. Its output rises and falls over a cycle; the figure here is the average.',
  Build_AlienPowerBuilding_C:
    'Takes somersloops to build. Adds its own power and boosts every generator on its grid, more when it’s fed Alien Power Matrices.',
  Build_ResourceSink_C: 'Takes any part worth points and turns the points into coupons for the AWESOME Shop.',
  Build_Mam_C: 'Research with parts and alien finds, and scan hard drives for alternate recipes.',
  Build_TradingPost_C: 'The HUB: deliver milestones here to unlock the next buildings and recipes.',
  Build_SpaceElevator_C: 'Deliver each phase’s parts here to open the next tiers.',
  Build_PowerStorageMk1_C: 'Stores spare power and gives it back when the grid needs more than the generators make.',
};
