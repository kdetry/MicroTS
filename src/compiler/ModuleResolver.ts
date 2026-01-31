/**
 * ModuleResolver - Resolves TypeScript module imports and builds dependency graph
 * 
 * Handles:
 * - Parsing import statements
 * - Resolving module paths
 * - Building compilation order (topological sort)
 * - Tracking exports for each module
 */

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

export interface ImportInfo {
    localName: string;      // Local name in importing module
    exportedName: string;   // Name as exported (usually same)
    fromModule: string;     // Module name (e.g., "math")
    fromPath: string;       // Absolute path to module
}

export interface ModuleInfo {
    path: string;           // Absolute path to .ts file
    name: string;           // Module name (basename without .ts)
    sourceFile: ts.SourceFile;
    program: ts.Program;
    exports: Set<string>;   // Exported function names
    imports: ImportInfo[];  // What this module imports
    dependencies: string[]; // Module names this depends on
}

export class ModuleResolver {
    private entryPath: string;
    private modules: Map<string, ModuleInfo> = new Map();
    private resolved: Set<string> = new Set();

    constructor(entryPath: string) {
        this.entryPath = path.resolve(entryPath);
    }

    /**
     * Resolve all dependencies starting from entry file
     */
    resolve(): ModuleInfo[] {
        this.resolveModule(this.entryPath);
        return this.getCompilationOrder();
    }

    /**
     * Recursively resolve a module and its dependencies
     */
    private resolveModule(modulePath: string): ModuleInfo | null {
        const absPath = path.resolve(modulePath);

        // Already resolved?
        if (this.resolved.has(absPath)) {
            return this.modules.get(this.getModuleName(absPath)) || null;
        }

        if (!fs.existsSync(absPath)) {
            throw new Error(`Module not found: ${absPath}`);
        }

        this.resolved.add(absPath);

        // Parse the module
        const program = ts.createProgram([absPath], {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            strict: false,
            skipLibCheck: true,
            skipDefaultLibCheck: true,
        });

        const sourceFile = program.getSourceFile(absPath);
        if (!sourceFile) {
            throw new Error(`Could not parse module: ${absPath}`);
        }

        const moduleName = this.getModuleName(absPath);
        const imports: ImportInfo[] = [];
        const exports = new Set<string>();
        const dependencies: string[] = [];

        // Walk the AST to find imports and exports
        ts.forEachChild(sourceFile, (node) => {
            // Handle: import { add } from './math'
            if (ts.isImportDeclaration(node)) {
                const importInfo = this.parseImportDeclaration(node, sourceFile, absPath);
                if (importInfo.length > 0) {
                    imports.push(...importInfo);
                    const depName = importInfo[0].fromModule;
                    if (!dependencies.includes(depName)) {
                        dependencies.push(depName);
                    }
                    // Recursively resolve the imported module
                    this.resolveModule(importInfo[0].fromPath);
                }
            }

            // Handle: export function add(...) { ... }
            if (ts.isFunctionDeclaration(node) && node.name) {
                const modifiers = ts.getModifiers(node);
                if (modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                    exports.add(node.name.getText(sourceFile));
                }
            }

            // Handle: export { add, multiply }
            if (ts.isExportDeclaration(node) && node.exportClause) {
                if (ts.isNamedExports(node.exportClause)) {
                    for (const element of node.exportClause.elements) {
                        exports.add(element.name.getText(sourceFile));
                    }
                }
            }
        });

        const moduleInfo: ModuleInfo = {
            path: absPath,
            name: moduleName,
            sourceFile,
            program,
            exports,
            imports,
            dependencies,
        };

        this.modules.set(moduleName, moduleInfo);
        return moduleInfo;
    }

    /**
     * Parse an import declaration
     */
    private parseImportDeclaration(
        node: ts.ImportDeclaration,
        sourceFile: ts.SourceFile,
        currentPath: string
    ): ImportInfo[] {
        const imports: ImportInfo[] = [];

        if (!ts.isStringLiteral(node.moduleSpecifier)) {
            return imports;
        }

        const specifier = node.moduleSpecifier.text;

        // Only handle relative imports
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
            return imports;  // Skip node_modules imports
        }

        // Resolve the path
        const currentDir = path.dirname(currentPath);
        let resolvedPath = path.resolve(currentDir, specifier);

        // Add .ts extension if needed
        if (!resolvedPath.endsWith(".ts")) {
            resolvedPath += ".ts";
        }

        const fromModule = this.getModuleName(resolvedPath);

        // Parse named imports: import { add, multiply } from './math'
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) {
                const localName = element.name.getText(sourceFile);
                const exportedName = element.propertyName
                    ? element.propertyName.getText(sourceFile)
                    : localName;

                imports.push({
                    localName,
                    exportedName,
                    fromModule,
                    fromPath: resolvedPath,
                });
            }
        }

        return imports;
    }

    /**
     * Get module name from path (basename without .ts)
     */
    private getModuleName(filePath: string): string {
        return path.basename(filePath, ".ts");
    }

    /**
     * Get modules in compilation order (dependencies first)
     */
    getCompilationOrder(): ModuleInfo[] {
        const result: ModuleInfo[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();  // For cycle detection

        const visit = (moduleName: string) => {
            if (visited.has(moduleName)) return;

            if (visiting.has(moduleName)) {
                throw new Error(`Circular dependency detected involving module: ${moduleName}`);
            }

            const moduleInfo = this.modules.get(moduleName);
            if (!moduleInfo) return;

            visiting.add(moduleName);

            // Visit dependencies first
            for (const dep of moduleInfo.dependencies) {
                visit(dep);
            }

            visiting.delete(moduleName);
            visited.add(moduleName);
            result.push(moduleInfo);
        };

        // Start with entry module
        const entryName = this.getModuleName(this.entryPath);
        visit(entryName);

        return result;
    }

    /**
     * Get a specific module by name
     */
    getModule(name: string): ModuleInfo | undefined {
        return this.modules.get(name);
    }
}
