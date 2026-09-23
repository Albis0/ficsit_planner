// Pulls item/building icons out of Satisfactory's IoStore archives and writes them as WebP.
// Usage: dotnet run -- <game dir> <icon-manifest.json> <out dir> [size]
using System.Text.Json;
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using SkiaSharp;

var gameDir = args.ElementAtOrDefault(0) ?? @"C:\Program Files\Epic Games\Satisfactory";
var manifestPath = args.ElementAtOrDefault(1) ?? Path.Combine("src", "data", "icon-manifest.json");
var outDir = args.ElementAtOrDefault(2) ?? Path.Combine("public", "icons");
var size = int.Parse(args.ElementAtOrDefault(3) ?? "96");

Directory.CreateDirectory(outDir);

// Oodle is what the game's archives are compressed with; CUE4Parse fetches the official DLL once.
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
provider.Initialize();
provider.Mount();
Console.WriteLine($"mounted {provider.Files.Count} files");

var manifest = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(manifestPath))!;
int ok = 0, failed = 0;
foreach (var (id, texPath) in manifest)
{
    try
    {
        var tex = provider.LoadPackageObject<UTexture2D>(texPath);
        var decoded = tex.Decode(ETexturePlatform.DesktopMobile) ?? throw new Exception("decode returned null");
        using var bitmap = decoded.ToSkBitmap();
        using var scaled = bitmap.Resize(new SKImageInfo(size, size, SKColorType.Rgba8888, SKAlphaType.Unpremul), SKFilterQuality.High);
        using var image = SKImage.FromBitmap(scaled);
        using var data = image.Encode(SKEncodedImageFormat.Webp, 90);
        File.WriteAllBytes(Path.Combine(outDir, $"{id}.webp"), data.ToArray());
        ok++;
    }
    catch (Exception e)
    {
        failed++;
        Console.WriteLine($"FAIL {id} {texPath}: {e.Message}");
    }
}
Console.WriteLine($"icons written {ok}, failed {failed}");
