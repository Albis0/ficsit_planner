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
