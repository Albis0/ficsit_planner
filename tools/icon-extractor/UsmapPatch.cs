using System.Buffers.Binary;

/// <summary>
/// The usmap Coffee Stain ships writes OptionalProperty with no inner type, while CUE4Parse
/// expects one (like ArrayProperty). Reading it as-is shifts every following byte. This rewrites
/// the file with a StrProperty inner type after each OptionalProperty, which is harmless for textures.
/// Only handles uncompressed usmap files at version 1 (PackageVersioning), which is what the game ships.
/// </summary>
static class UsmapPatch
{
    const byte StructProperty = 9, ArrayProperty = 8, MapProperty = 24, SetProperty = 25, EnumProperty = 26, OptionalProperty = 28, StrProperty = 10;

    public static byte[] AddOptionalInnerTypes(byte[] src)
    {
        var o = 0;
        ushort U16() { var v = BinaryPrimitives.ReadUInt16LittleEndian(src.AsSpan(o)); o += 2; return v; }
        int I32() { var v = BinaryPrimitives.ReadInt32LittleEndian(src.AsSpan(o)); o += 4; return v; }

        if (U16() != 0x30C4) throw new InvalidDataException("not a usmap");
        var version = src[o++];
        if (version != 1) throw new InvalidDataException($"unsupported usmap version {version}");
        if (I32() != 0)
        {
            o += 8; // UE4 + UE5 object versions
            var customVersions = I32();
            o += customVersions * 20; // guid + int each
            o += 4; // net CL
        }
        if (src[o++] != 0) throw new InvalidDataException("compressed usmap not supported");
        var sizeFieldsAt = o;
        o += 8;
        var dataStart = o;

        var output = new List<byte>(src.Length + 1024);
        output.AddRange(src.AsSpan(0, dataStart));
        var copiedTo = dataStart;
        var inserted = 0;

        var names = I32();
        for (var i = 0; i < names; i++) o += 1 + src[o];
        var enums = I32();
        for (var i = 0; i < enums; i++) { o += 4; var count = src[o++]; o += count * 4; }

        void Prop()
        {
            var type = src[o++];
            switch (type)
            {
                case EnumProperty: Prop(); o += 4; break;
                case StructProperty: o += 4; break;
                case ArrayProperty or SetProperty: Prop(); break;
                case MapProperty: Prop(); Prop(); break;
                case OptionalProperty:
                    output.AddRange(src.AsSpan(copiedTo, o - copiedTo));
                    output.Add(StrProperty);
                    copiedTo = o;
                    inserted++;
                    break;
            }
        }

        var structs = I32();
        for (var i = 0; i < structs; i++)
        {
            o += 8; // name, super
            U16(); // property count
            var serializable = U16();
            for (var p = 0; p < serializable; p++)
            {
                o += 2 + 1 + 4; // schema index, array size, name
                Prop();
            }
        }

        output.AddRange(src.AsSpan(copiedTo));
        var result = output.ToArray();
        var dataLength = result.Length - dataStart;
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(sizeFieldsAt), dataLength);
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(sizeFieldsAt + 4), dataLength);
        Console.WriteLine($"usmap: patched {inserted} OptionalProperty entries");
        return result;
    }
}
