import * as ts from "typescript";

/**
 * ParsedTypeReference - Represents a parsed generic type reference
 */
export interface ParsedTypeReference {
    baseName: string;               // e.g., "Box"
    typeArgs: ParsedTypeReference[]; // e.g., parsed "number" for Box<number>
    isGeneric: boolean;             // true if has type arguments
    text: string;                   // Original text like "Box<number>"
    node: ts.TypeNode;              // The original TypeNode
}

/**
 * TypeResolver - Parses and resolves generic type references
 * 
 * Handles:
 * - Simple types: number, Vector3
 * - Generic types: Box<number>, Pair<i32, f64>
 * - Nested generics: Box<Box<number>>
 */
export class TypeResolver {
    /**
     * Parse a TypeScript TypeNode into a ParsedTypeReference
     */
    parseTypeNode(node: ts.TypeNode, sourceFile: ts.SourceFile): ParsedTypeReference {
        const text = node.getText(sourceFile);

        // Handle TypeReferenceNode (e.g., Box<number>, Vector3)
        if (ts.isTypeReferenceNode(node)) {
            const baseName = node.typeName.getText(sourceFile);
            const typeArgs: ParsedTypeReference[] = [];

            // Parse type arguments if present
            if (node.typeArguments) {
                for (const typeArg of node.typeArguments) {
                    typeArgs.push(this.parseTypeNode(typeArg, sourceFile));
                }
            }

            return {
                baseName,
                typeArgs,
                isGeneric: node.typeArguments !== undefined && node.typeArguments.length > 0,
                text,
                node,
            };
        }

        // Handle other types as non-generic
        return {
            baseName: text,
            typeArgs: [],
            isGeneric: false,
            text,
            node,
        };
    }

    /**
     * Generate a mangled name for a generic type
     * Examples:
     *   Box<number>      -> Box_i32
     *   Box<Vector3>     -> Box_Vector3
     *   Pair<i32, f64>   -> Pair_i32_f64
     *   Box<Box<number>> -> Box_Box_i32
     */
    getMangledName(parsed: ParsedTypeReference, typeMapper?: (tsType: string) => string): string {
        if (!parsed.isGeneric) {
            // Non-generic type, optionally map it (e.g., number -> i32)
            if (typeMapper) {
                return typeMapper(parsed.text);
            }
            return parsed.text;
        }

        // Mangle base name
        let mangled = parsed.baseName;

        // Recursively mangle type arguments
        for (const typeArg of parsed.typeArgs) {
            const mangledArg = this.getMangledName(typeArg, typeMapper);
            mangled += "_" + mangledArg;
        }

        return mangled;
    }

    /**
     * Get the mangled type names for all type arguments
     */
    getTypeArgMangledNames(parsed: ParsedTypeReference, typeMapper?: (tsType: string) => string): string[] {
        return parsed.typeArgs.map(arg => this.getMangledName(arg, typeMapper));
    }

    /**
     * Check if a type reference is potentially generic
     * This is a quick check before full parsing
     */
    isPotentiallyGeneric(text: string): boolean {
        return text.includes("<") && text.includes(">");
    }
}
