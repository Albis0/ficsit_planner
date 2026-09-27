// Reads the world out of Satisfactory's IoStore archives: where the resource nodes, wells and geysers are.
// Usage: dotnet run -- <game dir> nodes <out.json>     (resource nodes, wells and geysers)
//        dotnet run -- <game dir> tex <dir> <path>...  (textures at their own size, e.g. the map's four slices)
//        dotnet run -- <game dir> list <text>          (every file path containing the text)
//        dotnet run -- <game dir> exports <package>    (a package's exports as JSON)
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Component;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.Core.i18N;

var gameDir = args[0];
var mode = args[1];

var oodlePath = Path.Combine(AppContext.BaseDirectory, OodleHelper.OODLE_NAME_CURRENT);
if (!File.Exists(oodlePath) && !OodleHelper.DownloadOodleDll(ref oodlePath)) throw new Exception("Oodle DLL download failed");
OodleHelper.Initialize(oodlePath);

var provider = new DefaultFileProvider(
    Path.Combine(gameDir, "FactoryGame", "Content", "Paks"),
    SearchOption.TopDirectoryOnly,
    new VersionContainer(EGame.GAME_UE5_6),
    StringComparer.OrdinalIgnoreCase);
var fixedUsmap = Path.Combine(Path.GetTempPath(), "FactoryGame.cue4parse.usmap");
File.WriteAllBytes(fixedUsmap, UsmapPatch.AddOptionalInnerTypes(File.ReadAllBytes(Path.Combine(gameDir, "CommunityResources", "FactoryGame.usmap"))));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(fixedUsmap, StringComparer.OrdinalIgnoreCase);
provider.ReadScriptData = true;
provider.Initialize();
provider.Mount();
Console.Error.WriteLine($"mounted {provider.Files.Count} files");

if (mode == "list")
{
    foreach (var f in provider.Files.Keys.Where(k => k.Contains(args[2], StringComparison.OrdinalIgnoreCase)))
        Console.WriteLine(f);
    return;
}

if (mode == "exports")
{
    var pkg = provider.LoadPackage(args[2]);
    Console.WriteLine(JsonConvert.SerializeObject(pkg.GetExports(), Formatting.Indented));
    return;
}

if (mode == "big")
{
    foreach (var f in provider.Files.Values.Where(f => f.Path.Contains("Interface", StringComparison.OrdinalIgnoreCase) || f.Path.Contains("/Map/", StringComparison.OrdinalIgnoreCase)).OrderByDescending(f => f.Size).Take(60))
        Console.WriteLine($"{f.Size,12} {f.Path}");
    return;
}

if (mode == "scan")
{
    var counts = new Dictionary<string, (int n, string first)>();
    var cells = provider.Files.Keys.Where(k => k.Contains("GameLevel01/Persistent_Level", StringComparison.OrdinalIgnoreCase) && k.EndsWith(".umap")).ToList();
    Console.Error.WriteLine($"{cells.Count} cells");
    var i = 0;
    foreach (var cell in cells)
    {
        if (++i % 500 == 0) Console.Error.WriteLine(i);
        try
        {
            var pkg = provider.LoadPackage(cell);
            foreach (var e in pkg.GetExports())
            {
                string cls = e.Class?.Name.ToString() ?? e.ExportType;
                if (!cls.Contains(args[2], StringComparison.OrdinalIgnoreCase)) continue;
                counts[cls] = counts.TryGetValue(cls, out var c) ? (c.n + 1, c.first) : (1, $"{cell} :: {e.Name}");
            }
        }
        catch (Exception ex) { Console.Error.WriteLine($"FAIL {cell}: {ex.Message}"); }
    }
    foreach (var (k, v) in counts.OrderBy(k => k.Key)) Console.WriteLine($"{v.n,6} {k}  {v.first}");
    return;
}

// "world <out.json>": everything else worth finding: somersloops, mercer spheres, power slugs, crash sites,
// tapes, berries, nuts, mushrooms and where creatures spawn. Most sit in the level's streamed cells.
if (mode == "world")
{
    var kinds = new Dictionary<string, string>
    {
        ["BP_WAT1_C"] = "sloop",
        ["BP_WAT2_C"] = "sphere",
        ["BP_Crystal_C"] = "slug1",
        ["BP_Crystal_mk2_C"] = "slug2",
        ["BP_Crystal_mk3_C"] = "slug3",
        ["BP_DropPod_C"] = "pod",
        ["BP_TapePickup_C"] = "tape",
        ["BP_UnlockPickup_Customization_C"] = "cosmetic",
        ["BP_BerryBush_C"] = "berry",
        ["BP_NutBush_C"] = "nut",
        ["BP_Shroom_01_C"] = "shroom",
        ["BP_CreatureSpawner_C"] = "spawner",
        ["Char_CrabHatcher_C"] = "hatcher",
        ["Char_BigCrabHatcher_C"] = "bighatcher",
    };
    var cells = provider.Files.Keys.Where(k => k.Contains("GameLevel01/Persistent_Level", StringComparison.OrdinalIgnoreCase) && k.EndsWith(".umap")).ToList();
    var list = new List<object>();
    var seen = new HashSet<string>();
    var n = 0;
    foreach (var cell in cells)
    {
        if (++n % 1000 == 0) Console.Error.WriteLine(n);
        CUE4Parse.UE4.Assets.IPackage pkg;
        try { pkg = provider.LoadPackage(cell); } catch (Exception ex) { Console.Error.WriteLine($"FAIL {cell}: {ex.Message}"); continue; }
        foreach (var e in pkg.GetExports())
        {
            if (!kinds.TryGetValue(e.Class?.Name.ToString() ?? "", out var kind)) continue;
            FVector at;
            try
            {
                var root = e.GetOrDefault<FPackageIndex>("RootComponent")?.Load<USceneComponent>();
                if (root == null) continue;
                at = root.GetOrDefault<FVector>("RelativeLocation");
            }
            catch { continue; }
            var key = $"{kind}:{Math.Round(at.X / 50)}:{Math.Round(at.Y / 50)}:{Math.Round(at.Z / 50)}";
            if (!seen.Add(key)) continue;
            string? what = null;
            object? cost = null;
            int? count = null;
            if (kind == "spawner")
            {
                what = e.GetOrDefault<FPackageIndex>("mCreatureClass")?.Name;
                count = e.GetOrDefault<FStructFallback[]>("mSpawnData")?.Length;
            }
            else if (kind == "tape" || kind == "cosmetic") what = e.GetOrDefault<FPackageIndex>("mSchematic")?.Name;
            else if (kind == "pod")
            {
                var c = e.GetOrDefault<FStructFallback>("mUnlockCost");
                if (c != null)
                {
                    var type = c.GetOrDefault<FName>("CostType").Text.Split("::").Last();
                    var item = c.GetOrDefault<FStructFallback>("ItemCost");
                    cost = new
                    {
                        type,
                        item = item?.GetOrDefault<FPackageIndex>("ItemClass")?.Name,
                        amount = item?.GetOrDefault<int>("Amount"),
                        power = c.GetOrDefault<float>("PowerConsumption"),
                    };
                }
            }
            list.Add(new { kind, what, cost, count, x = Math.Round(at.X), y = Math.Round(at.Y), z = Math.Round(at.Z) });
        }
    }
    File.WriteAllText(args[2], JsonConvert.SerializeObject(list, Formatting.Indented));
    Console.WriteLine($"{list.Count} written");
    return;
}

// "creatures <out.json> <class>...": each creature's health, speed and what it drops, from its blueprint and the
// blueprints it inherits from.
if (mode == "creatures")
{
    var list = new List<object>();
    foreach (var cls in args.Skip(3))
    {
        var name = cls.EndsWith("_C") ? cls[..^2] : cls;
        float? health = null;
        string? drop = null, family = null, parent = null;
        float? run = null, sprint = null;
        var current = name;
        for (var depth = 0; depth < 6 && current != null; depth++)
        {
            var path = provider.Files.Keys.FirstOrDefault(k => k.EndsWith($"/{current}.uasset", StringComparison.OrdinalIgnoreCase) && k.Contains("/Character/", StringComparison.OrdinalIgnoreCase));
            if (path == null) break;
            var pkg = provider.LoadPackage(path);
            var exports = pkg.GetExports().ToList();
            var cdo = exports.FirstOrDefault(e => e.Name == $"Default__{current}_C");
            var hc = exports.FirstOrDefault(e => e.Name == "HealthComponent" && e.Outer?.Name == $"Default__{current}_C") ?? exports.FirstOrDefault(e => e.Name == "HealthComponent");
            if (health == null && hc != null && hc.TryGetValue(out float h, "mMaxHealth")) health = h;
            if (cdo != null)
            {
                drop ??= cdo.GetOrDefault<FPackageIndex>("mItemToDrop")?.Name;
                family ??= cdo.GetOrDefault<FPackageIndex>("mCreatureFamily")?.Name;
                var speeds = cdo.GetOrDefault<FStructFallback[]>("mMoveSpeedData");
                if (speeds != null && run == null)
                    foreach (var sp in speeds)
                    {
                        var t = sp.GetOrDefault<FName>("MoveSpeedType").Text;
                        if (t.EndsWith("MS_Run")) run = sp.GetOrDefault<float>("Speed");
                        if (t.EndsWith("MS_Sprint")) sprint = sp.GetOrDefault<float>("Speed");
                    }
            }
            var klass = exports.OfType<CUE4Parse.UE4.Objects.Engine.UBlueprintGeneratedClass>().FirstOrDefault();
            var super = klass?.SuperStruct?.Name;
            if (depth == 0) parent = super;
            current = super != null && super.StartsWith("Char_") ? super[..^2] : null;
        }
        list.Add(new { id = cls, health, drop, family, parent, run, sprint });
    }
    File.WriteAllText(args[2], JsonConvert.SerializeObject(list, Formatting.Indented));
    Console.WriteLine($"{list.Count} written");
    return;
}

// "raw <path> <out>": a file from the archives as it is (e.g. a string table CSV).
if (mode == "raw")
{
    File.WriteAllBytes(args[3], provider.SaveAsset(args[2]));
    Console.WriteLine("saved");
    return;
}

// "descriptors <dir> <out.json>": every creature descriptor: which creature, its name key and its icon.
if (mode == "descriptors")
{
    var list = new List<object>();
    foreach (var path in provider.Files.Keys.Where(k => k.Contains(args[2], StringComparison.OrdinalIgnoreCase) && k.EndsWith(".uasset") && !k.Contains("/UI/")))
    {
        var pkg = provider.LoadPackage(path);
        var cdo = pkg.GetExports().FirstOrDefault(e => e.Name.StartsWith("Default__"));
        if (cdo == null) continue;
        var name = cdo.GetOrDefault<FText>("mDisplayName");
        list.Add(new
        {
            id = cdo.Name["Default__".Length..],
            creature = cdo.GetOrDefault<FPackageIndex>("mCreatureClass")?.Name,
            nameKey = (name?.TextHistory as FTextHistory.StringTableEntry)?.Key,
            nameText = name?.Text,
            icon = cdo.GetOrDefault<FPackageIndex>("mPersistentBigIcon")?.ResolvedObject?.GetPathName(),
        });
    }
    File.WriteAllText(args[3], JsonConvert.SerializeObject(list, Formatting.Indented));
    Console.WriteLine($"{list.Count} written");
    return;
}

// "dump <class> <n>": the first n actors of a class in any cell of the level, as JSON, to see what they hold.
if (mode == "dump")
{
    var want = int.Parse(args[3]);
    var cells = provider.Files.Keys.Where(k => k.Contains("GameLevel01/Persistent_Level", StringComparison.OrdinalIgnoreCase) && k.EndsWith(".umap")).ToList();
    var found = new List<object>();
    foreach (var cell in cells)
    {
        if (found.Count >= want) break;
        try
        {
            var pkg = provider.LoadPackage(cell);
            foreach (var e in pkg.GetExports())
            {
                if (e.Class?.Name.ToString() != args[2]) continue;
                var root = e.GetOrDefault<FPackageIndex>("RootComponent")?.Load<USceneComponent>();
                found.Add(new { cell, actor = e, root });
                if (found.Count >= want) break;
            }
        }
        catch (Exception ex) { Console.Error.WriteLine($"FAIL {cell}: {ex.Message}"); }
    }
    Console.WriteLine(JsonConvert.SerializeObject(found, Formatting.Indented));
    return;
}

// "tex <out dir> <path>...": textures at their own size, as PNG.
if (mode == "tex")
{
    Directory.CreateDirectory(args[2]);
    foreach (var path in args.Skip(3))
    {
        try
        {
            var name = Path.GetFileNameWithoutExtension(path);
            var tex = provider.LoadPackageObject<UTexture2D>($"{path}.{name}");
            using var bmp = tex.Decode(ETexturePlatform.DesktopMobile)!.ToSkBitmap();
            using var img = SKImage.FromBitmap(bmp);
            File.WriteAllBytes(Path.Combine(args[2], name + ".png"), img.Encode(SKEncodedImageFormat.Png, 100).ToArray());
            Console.WriteLine($"{name} {bmp.Width}x{bmp.Height}");
        }
        catch (Exception e) { Console.WriteLine($"FAIL {path}: {e.Message}"); }
    }
    return;
}

// "nodes <out.json>": every resource node, resource well (core and satellites) and geyser in the world, where it is
// and how pure. They're all always-loaded actors of the persistent level.
if (mode == "nodes")
{
    var kinds = new Dictionary<string, string>
    {
        ["BP_ResourceNode_C"] = "node",
        ["BP_ResourceNodeGeyser_C"] = "geyser",
        ["BP_FrackingCore_C"] = "core",
        ["BP_FrackingSatellite_C"] = "well",
    };
    var level = provider.LoadPackage("FactoryGame/Content/FactoryGame/Map/GameLevel01/Persistent_Level.umap");
    var list = new List<object>();
    foreach (var e in level.GetExports())
    {
        if (!kinds.TryGetValue(e.Class?.Name.ToString() ?? "", out var kind)) continue;
        var root = e.GetOrDefault<FPackageIndex>("RootComponent")?.Load<USceneComponent>();
        var at = root?.GetOrDefault<FVector>("RelativeLocation") ?? throw new Exception($"{e.Name}: no location");
        var resource = e.GetOrDefault<FPackageIndex>("mResourceClass")?.Name;
        var purity = e.GetOrDefault<FName>("mPurity").Text;
        var core = e.GetOrDefault<FPackageIndex>("mCore")?.Name;
        list.Add(new
        {
            id = e.Name,
            kind,
            resource = kind == "geyser" ? "Desc_Geyser_C" : resource,
            purity = string.IsNullOrEmpty(purity) || purity == "None" ? "RP_Normal" : purity.Split("::").Last(),
            core,
            x = Math.Round(at.X),
            y = Math.Round(at.Y),
            z = Math.Round(at.Z),
        });
    }
    File.WriteAllText(args[2], JsonConvert.SerializeObject(list, Formatting.Indented));
    Console.WriteLine($"{list.Count} written");
    return;
}
