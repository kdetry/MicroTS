/**
 * StructRegistry - Manages TypeScript interface to LLVM struct mappings
 * 
 * Stores struct definitions including field names, types, indices, and sizes
 * for getelementptr access and sizeof calculations.
 */

export interface StructField {
    name: string;       // Field name (e.g., "x")
    type: string;       // LLVM type (e.g., "i32", "%Point*")
    tsType: string;     // Original TypeScript type
    index: number;      // Field index for GEP
    offset: number;     // Byte offset (for sizeof)
    size: number;       // Field size in bytes
}

export interface StructDef {
    name: string;           // Struct name (e.g., "Point")
    fields: StructField[];  // Ordered list of fields
    size: number;           // Total size in bytes
    llvmType: string;       // e.g., "{ i32, i32 }"
    llvmPtrType: string;    // e.g., "%Point*"
}

export class StructRegistry {
    private structs: Map<string, StructDef> = new Map();

    /**
     * Register a new struct definition
     */
    register(name: string, fields: { name: string; tsType: string; llvmType: string }[]): StructDef {
        const structFields: StructField[] = [];
        let offset = 0;

        for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const size = this.getTypeSize(f.llvmType);

            structFields.push({
                name: f.name,
                type: f.llvmType,
                tsType: f.tsType,
                index: i,
                offset,
                size,
            });

            offset += size;
        }

        const llvmFieldTypes = structFields.map(f => f.type).join(", ");
        const structDef: StructDef = {
            name,
            fields: structFields,
            size: offset,
            llvmType: `{ ${llvmFieldTypes} }`,
            llvmPtrType: `%${name}*`,
        };

        this.structs.set(name, structDef);
        return structDef;
    }

    /**
     * Get a struct definition by name
     */
    get(name: string): StructDef | undefined {
        return this.structs.get(name);
    }

    /**
     * Check if a type is a registered struct
     */
    isStruct(typeName: string): boolean {
        // Remove pointer suffix if present
        const baseName = typeName.replace(/\*$/, "").replace(/^\%/, "");
        return this.structs.has(baseName);
    }

    /**
     * Get field by name from a struct
     */
    getField(structName: string, fieldName: string): StructField | undefined {
        const struct = this.structs.get(structName);
        if (!struct) return undefined;
        return struct.fields.find(f => f.name === fieldName);
    }

    /**
     * Get the size of a type in bytes
     */
    getTypeSize(llvmType: string): number {
        // Handle pointers (8 bytes on 64-bit)
        if (llvmType.endsWith("*")) {
            return 8;
        }

        // Handle basic types
        switch (llvmType) {
            case "i1": return 1;
            case "i8": return 1;
            case "i16": return 2;
            case "i32": return 4;
            case "i64": return 8;
            case "float": return 4;
            case "double": return 8;
            default:
                // Check if it's a struct type
                const structName = llvmType.replace(/^\%/, "");
                const struct = this.structs.get(structName);
                if (struct) {
                    return struct.size;
                }
                // Default to pointer size for unknown types
                return 8;
        }
    }

    /**
     * Get all registered structs (for LLVM IR emission)
     */
    getAll(): StructDef[] {
        return Array.from(this.structs.values());
    }

    /**
     * Get structs in dependency order (dependencies first)
     */
    getTopologicalOrder(): StructDef[] {
        const result: StructDef[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (name: string) => {
            if (visited.has(name)) return;
            if (visiting.has(name)) {
                throw new Error(`Circular struct dependency detected: ${name}`);
            }

            const struct = this.structs.get(name);
            if (!struct) return;

            visiting.add(name);

            // Visit dependencies first
            for (const field of struct.fields) {
                // Check if field type is another struct
                const fieldTypeName = field.type.replace(/\*$/, "").replace(/^\%/, "");
                if (this.structs.has(fieldTypeName)) {
                    visit(fieldTypeName);
                }
            }

            visiting.delete(name);
            visited.add(name);
            result.push(struct);
        };

        for (const name of this.structs.keys()) {
            visit(name);
        }

        return result;
    }
}
