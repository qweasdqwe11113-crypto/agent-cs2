using System.Collections;
using ValveResourceFormat;
using System.Numerics;
using System.Text.Json;
using Datamodel;
using Datamodel.Codecs;

if (args.FirstOrDefault() == "--inspect-vpk")
{
    foreach (var type in typeof(Resource).Assembly.GetTypes().Where(type => type.FullName?.Contains("Pak", StringComparison.OrdinalIgnoreCase) == true)) Console.WriteLine(type.FullName);
    return;
}

var sourceDirectory = args.Length > 0 ? args[0] : Path.Combine("..", "..", "apps", "worker", "assets", "maps", "de_mirage", "source", "decompiled");
var outputPath = args.Length > 1 ? args[1] : Path.Combine("..", "..", "apps", "worker", "assets", "maps", "de_mirage", "processed", "collision.json");
var hulls = new List<Hull>();

foreach (var file in Directory.EnumerateFiles(sourceDirectory, "world_physics_hull*.dmx").OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
{
    var document = Datamodel.Datamodel.Load(file, DeferredMode.Disabled);
    var vertexData = document.AllElements.FirstOrDefault(element => element.ClassName == "DmeVertexData");
    var faceSet = document.AllElements.FirstOrDefault(element => element.ClassName == "DmeFaceSet");
    if (vertexData is null || faceSet is null || vertexData["position$0"] is not IEnumerable positions || faceSet["faces"] is not IEnumerable faces) continue;

    var vertices = positions.Cast<object>().OfType<Vector3>().Select(vector => new Vec3(vector.X, vector.Y, vector.Z)).ToArray();
    var indices = faces.Cast<object>().Select(Convert.ToInt32).ToArray();
    if (vertices.Length > 0 && indices.Length > 0) hulls.Add(new Hull(Path.GetFileName(file), vertices, indices));
}

Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
var payload = new CollisionMap("de_mirage", "source2-dmx-v1", hulls.Count, hulls);
await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = false }));
Console.WriteLine($"Wrote {hulls.Count} collision hulls to {Path.GetFullPath(outputPath)}");

record Vec3(float X, float Y, float Z);
record Hull(string Source, Vec3[] Vertices, int[] Faces);
record CollisionMap(string MapName, string SchemaVersion, int HullCount, List<Hull> Hulls);
