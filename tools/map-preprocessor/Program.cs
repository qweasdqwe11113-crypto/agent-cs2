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

if (args.FirstOrDefault() == "--inspect-nav")
{
    foreach (var type in typeof(Resource).Assembly.GetTypes()
        .Where(type => type.FullName?.Contains("nav", StringComparison.OrdinalIgnoreCase) == true)
        .OrderBy(type => type.FullName, StringComparer.Ordinal))
    {
        Console.WriteLine(type.FullName);
    }
    return;
}

if (args.FirstOrDefault() == "--nav-header")
{
    var navPath = args.ElementAtOrDefault(1) ?? Path.Combine("..", "..", "apps", "worker", "assets", "maps", "de_mirage", "source", "de_mirage.nav");
    using var stream = File.OpenRead(navPath);
    using var reader = new BinaryReader(stream);
    Console.WriteLine($"magic={reader.ReadUInt32():X8} navVersion={reader.ReadUInt32()} sub={reader.ReadUInt32()} flags={reader.ReadUInt32():X8}");
    stream.Position = (stream.Position + 7) & ~7L;
    Console.WriteLine($"kv3Offset={stream.Position} magic={reader.ReadUInt32():X8}");
    Console.WriteLine($"guid={new Guid(reader.ReadBytes(16))} compression={reader.ReadUInt32()} dict={reader.ReadUInt16()} frame={reader.ReadUInt16()}");
    Console.WriteLine($"b1={reader.ReadInt32()} b4={reader.ReadInt32()} b8={reader.ReadInt32()} types={reader.ReadInt32()} obj={reader.ReadUInt16()} arr={reader.ReadUInt16()} totalRaw={reader.ReadInt32()} totalCompressed={reader.ReadInt32()} blocks={reader.ReadInt32()} blobBytes={reader.ReadInt32()} b2={reader.ReadInt32()} blockSizes={reader.ReadInt32()}");
    Console.WriteLine($"v5 raw1={reader.ReadInt32()} compressed1={reader.ReadInt32()} raw2={reader.ReadInt32()} compressed2={reader.ReadInt32()} b1_2={reader.ReadInt32()} b2_2={reader.ReadInt32()} b4_2={reader.ReadInt32()} b8_2={reader.ReadInt32()} unknown={reader.ReadInt32()} obj2={reader.ReadInt32()} arr2={reader.ReadInt32()} unknown2={reader.ReadInt32()} headerEnd={stream.Position}");
    return;
}

if (args.FirstOrDefault() == "--nav")
{
    var navPath = args.ElementAtOrDefault(1) ?? Path.Combine("..", "..", "apps", "worker", "assets", "maps", "de_mirage", "source", "de_mirage.nav");
    var navOutputPath = args.ElementAtOrDefault(2) ?? Path.Combine("..", "..", "apps", "worker", "assets", "maps", "de_mirage", "processed", "navmesh.json");
    var navMesh = ReadSource2Nav(navPath);
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(navOutputPath))!);
    await File.WriteAllTextAsync(navOutputPath, JsonSerializer.Serialize(navMesh, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    Console.WriteLine($"Wrote {navMesh.Areas.Count} official nav areas (version {navMesh.NavVersion}) to {Path.GetFullPath(navOutputPath)}");
    return;
}

if (args.FirstOrDefault() == "--inspect-resource")
{
    var resourcePath = args.ElementAtOrDefault(1) ?? throw new ArgumentException("Provide a compiled Source 2 resource path.");
    var resource = new Resource();
    resource.Read(resourcePath);
    Console.WriteLine($"type={resource.ResourceType} block={resource.DataBlock?.GetType().FullName}");
    Console.WriteLine(resource.DataBlock?.ToString());
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

static Source2NavMesh ReadSource2Nav(string path)
{
    using var stream = File.OpenRead(path);
    using var reader = new BinaryReader(stream);
    if (reader.ReadUInt32() != 0xFEEDFACE) throw new InvalidDataException("Not a Source 2 NAV file.");
    var version = reader.ReadUInt32();
    if (version is < 31 or > 36) throw new InvalidDataException($"Unsupported NAV version {version}.");
    _ = reader.ReadUInt32(); // sub-version
    _ = reader.ReadUInt32(); // analysis flags

    if (version >= 36) SkipKv3(reader);

    var vertices = new Vec3[reader.ReadUInt32()];
    for (var i = 0; i < vertices.Length; i++) vertices[i] = new Vec3(reader.ReadSingle(), reader.ReadSingle(), reader.ReadSingle());

    var polygons = new Vec3[reader.ReadUInt32()][];
    for (var i = 0; i < polygons.Length; i++)
    {
        var cornerCount = reader.ReadByte();
        var polygon = new Vec3[cornerCount];
        for (var corner = 0; corner < cornerCount; corner++) polygon[corner] = vertices[reader.ReadUInt32()];
        if (version >= 35) _ = reader.ReadUInt32();
        polygons[i] = polygon;
    }

    if (version >= 32) _ = reader.ReadUInt32();
    if (version >= 35)
    {
        var unknownEntryCount = reader.ReadUInt32();
        for (var i = 0; i < unknownEntryCount; i++)
        {
            while (reader.ReadByte() != 0) { }
            stream.Position += 48;
        }
    }
    if (version >= 36) SkipKv3(reader);

    var areas = new List<NavArea>();
    var areaCount = reader.ReadUInt32();
    for (var i = 0; i < areaCount; i++)
    {
        var id = reader.ReadUInt32();
        _ = reader.ReadInt64(); // dynamic attributes
        var hull = reader.ReadByte();
        var polygon = polygons[reader.ReadUInt32()];
        _ = reader.ReadSingle();
        var connectedAreaIds = new List<uint>();
        for (var corner = 0; corner < polygon.Length; corner++)
        {
            var connections = reader.ReadUInt32();
            for (var connection = 0; connection < connections; connection++)
            {
                connectedAreaIds.Add(reader.ReadUInt32());
                _ = reader.ReadUInt32(); // edge ID
            }
        }
        _ = reader.ReadByte();
        _ = reader.ReadUInt32();
        var laddersAbove = reader.ReadUInt32(); stream.Position += laddersAbove * 4L;
        var laddersBelow = reader.ReadUInt32(); stream.Position += laddersBelow * 4L;
        areas.Add(new NavArea(id, hull, polygon, connectedAreaIds.Distinct().ToArray()));
    }
    return new Source2NavMesh("de_mirage", "source2-nav-v1", "official-de_mirage.nav", version, areas);
}

static void SkipKv3(BinaryReader reader)
{
    var stream = reader.BaseStream;
    stream.Position = (stream.Position + 7) & ~7L;
    var magic = reader.ReadUInt32();
    if (magic != 0x4B563305) throw new InvalidDataException($"Expected KV3 v5 in NAV, got {magic:X8}.");
    stream.Position += 16; // format GUID
    var compression = reader.ReadUInt32();
    _ = reader.ReadUInt16(); _ = reader.ReadUInt16();
    _ = reader.ReadInt32(); _ = reader.ReadInt32(); _ = reader.ReadInt32(); _ = reader.ReadInt32();
    _ = reader.ReadUInt16(); _ = reader.ReadUInt16();
    _ = reader.ReadInt32(); _ = reader.ReadInt32(); _ = reader.ReadInt32();
    var binaryBlobBytes = reader.ReadInt32();
    _ = reader.ReadInt32(); _ = reader.ReadInt32();
    var rawBuffer1 = reader.ReadInt32(); var compressedBuffer1 = reader.ReadInt32();
    var rawBuffer2 = reader.ReadInt32(); var compressedBuffer2 = reader.ReadInt32();
    stream.Position += 32; // v5 buffer-2 layout counters
    if (compression != 0) throw new InvalidDataException("Compressed KV3 NAV metadata is not supported by this preprocessor yet.");
    stream.Position += rawBuffer1 + rawBuffer2 + binaryBlobBytes;
    if (compressedBuffer1 != 0 || compressedBuffer2 != 0) throw new InvalidDataException("Unexpected compressed KV3 buffer lengths.");
}

record Vec3(float X, float Y, float Z);
record Hull(string Source, Vec3[] Vertices, int[] Faces);
record CollisionMap(string MapName, string SchemaVersion, int HullCount, List<Hull> Hulls);
record NavArea(uint Id, byte Hull, Vec3[] Polygon, uint[] ConnectedAreaIds);
record Source2NavMesh(string MapName, string SchemaVersion, string Source, uint NavVersion, List<NavArea> Areas);
