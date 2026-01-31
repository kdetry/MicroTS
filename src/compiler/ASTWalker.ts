import * as ts from "typescript";
import { Emitter } from "./Emitter";
import { Context } from "./Context";
import { TypeMapper } from "./TypeMapper";

/**
 * ExternFunction - Tracks declared external functions (C FFI)
 */
interface ExternFunction {
    name: string;
    returnType: string;
    params: { name: string; type: string }[];
    isVariadic: boolean;
}

/**
 * ASTWalker - Traverses TypeScript AST and generates LLVM IR
 * 
 * Phase 1-3: Handles functions, variables, expressions, and C FFI
 */
export class ASTWalker {
    private emitter: Emitter;
    private sourceFile: ts.SourceFile;
    private program: ts.Program;
    private typeChecker: ts.TypeChecker;
    private context: Context;
    private externFunctions: Map<string, ExternFunction> = new Map();

    constructor(sourceFile: ts.SourceFile, program: ts.Program, moduleName: string) {
        this.sourceFile = sourceFile;
        this.program = program;
        this.typeChecker = program.getTypeChecker();
        this.emitter = new Emitter(moduleName);
        this.context = new Context();
    }

    /**
     * Walk the entire source file and generate LLVM IR
     */
    walk(): string {
        // First pass: collect all declare statements (external functions)
        ts.forEachChild(this.sourceFile, (node) => {
            if (ts.isFunctionDeclaration(node) && !node.body) {
                // This is a "declare function" - external C function
                this.visitDeclareFunction(node);
            }
        });

        // Second pass: process all function definitions
        ts.forEachChild(this.sourceFile, (node) => {
            if (ts.isFunctionDeclaration(node) && node.body) {
                this.visitFunctionDeclaration(node);
            }
        });

        return this.emitter.getOutput();
    }

    /**
     * Process a declare function (external C function)
     */
    private visitDeclareFunction(node: ts.FunctionDeclaration): void {
        const funcName = node.name?.getText(this.sourceFile);
        if (!funcName) return;

        // Get return type
        const returnType = this.getReturnType(node);
        const llvmReturnType = TypeMapper.mapType(returnType);

        // Get parameters
        const params: { name: string; type: string }[] = [];
        let isVariadic = false;

        for (const param of node.parameters) {
            // Check for rest parameter (...args)
            if (param.dotDotDotToken) {
                isVariadic = true;
                continue;
            }

            const paramName = param.name.getText(this.sourceFile);
            let paramType = "i32";
            if (param.type) {
                paramType = TypeMapper.mapType(param.type.getText(this.sourceFile));
            }
            params.push({ name: paramName, type: paramType });
        }

        // Store extern function info
        this.externFunctions.set(funcName, {
            name: funcName,
            returnType: llvmReturnType,
            params,
            isVariadic,
        });

        // Emit the extern declaration
        const paramTypes = params.map(p => p.type).join(", ");
        this.emitter.addExternFunction(funcName, llvmReturnType, paramTypes, isVariadic);
    }

    /**
     * Process a function declaration
     */
    private visitFunctionDeclaration(node: ts.FunctionDeclaration): void {
        const funcName = node.name?.getText(this.sourceFile);

        if (!funcName) {
            console.warn("Skipping anonymous function");
            return;
        }

        // Reset context for new function
        this.context = new Context();

        // Get return type
        const returnType = this.getReturnType(node);
        const llvmReturnType = TypeMapper.mapType(returnType);

        // Emit function start
        this.emitter.emitFunctionStart(funcName, llvmReturnType);

        // Process function body
        if (node.body) {
            this.visitBlock(node.body);
        }

        // Emit function end
        this.emitter.emitFunctionEnd();
    }

    /**
     * Process a block statement
     */
    private visitBlock(node: ts.Block): void {
        this.context.pushScope();
        for (const statement of node.statements) {
            this.visitStatement(statement);
        }
        this.context.popScope();
    }

    /**
     * Process a statement
     */
    private visitStatement(node: ts.Statement): void {
        if (ts.isReturnStatement(node)) {
            this.visitReturnStatement(node);
        } else if (ts.isVariableStatement(node)) {
            this.visitVariableStatement(node);
        } else if (ts.isExpressionStatement(node)) {
            this.visitExpression(node.expression);
        } else if (ts.isIfStatement(node)) {
            this.visitIfStatement(node);
        } else if (ts.isWhileStatement(node)) {
            this.visitWhileStatement(node);
        } else if (ts.isForStatement(node)) {
            this.visitForStatement(node);
        } else if (ts.isBlock(node)) {
            this.visitBlock(node);
        }
    }

    /**
     * Process a variable statement (let x = 5;)
     */
    private visitVariableStatement(node: ts.VariableStatement): void {
        for (const decl of node.declarationList.declarations) {
            this.visitVariableDeclaration(decl);
        }
    }

    /**
     * Process a single variable declaration
     */
    private visitVariableDeclaration(node: ts.VariableDeclaration): void {
        const name = node.name.getText(this.sourceFile);

        // Determine type
        let llvmType = "i32";  // Default
        if (node.type) {
            llvmType = TypeMapper.mapType(node.type.getText(this.sourceFile));
        }

        // Declare variable in context
        const variable = this.context.declareVariable(name, llvmType);

        // Emit alloca for stack allocation
        this.emitter.emitAlloca(variable.llvmName, llvmType);

        // If there's an initializer, store the value
        if (node.initializer) {
            const value = this.visitExpression(node.initializer);
            this.emitter.emitStore(llvmType, value, variable.llvmName);
        }
    }

    /**
     * Process a return statement
     */
    private visitReturnStatement(node: ts.ReturnStatement): void {
        if (node.expression) {
            const value = this.visitExpression(node.expression);
            // For now, assume i32 return type
            this.emitter.emitReturn("i32", value);
        } else {
            this.emitter.emitReturn("void", "");
        }
    }

    /**
     * Process an if statement
     * 
     * Generates:
     *   %cond = <condition>
     *   br i1 %cond, label %then, label %else
     * then:
     *   <then body>
     *   br label %endif
     * else:
     *   <else body>
     *   br label %endif
     * endif:
     */
    private visitIfStatement(node: ts.IfStatement): void {
        const thenLabel = this.context.nextLabel("if.then");
        const elseLabel = this.context.nextLabel("if.else");
        const endLabel = this.context.nextLabel("if.end");

        // Evaluate condition
        const condition = this.visitExpression(node.expression);

        // Convert to i1 if needed (compare with 0)
        const condReg = this.ensureBooleanCondition(condition);

        if (node.elseStatement) {
            // Branch based on condition
            this.emitter.emitConditionalBranch(condReg, thenLabel, elseLabel);

            // Then block
            this.emitter.emitLabel(thenLabel);
            this.visitStatement(node.thenStatement);
            this.emitter.emitBranch(endLabel);

            // Else block
            this.emitter.emitLabel(elseLabel);
            this.visitStatement(node.elseStatement);
            this.emitter.emitBranch(endLabel);
        } else {
            // No else block
            this.emitter.emitConditionalBranch(condReg, thenLabel, endLabel);

            // Then block
            this.emitter.emitLabel(thenLabel);
            this.visitStatement(node.thenStatement);
            this.emitter.emitBranch(endLabel);
        }

        // End label (continuation)
        this.emitter.emitLabel(endLabel);
    }

    /**
     * Process a while statement
     * 
     * Generates:
     *   br label %while.cond
     * while.cond:
     *   %cond = <condition>
     *   br i1 %cond, label %while.body, label %while.end
     * while.body:
     *   <body>
     *   br label %while.cond
     * while.end:
     */
    private visitWhileStatement(node: ts.WhileStatement): void {
        const condLabel = this.context.nextLabel("while.cond");
        const bodyLabel = this.context.nextLabel("while.body");
        const endLabel = this.context.nextLabel("while.end");

        // Jump to condition check
        this.emitter.emitBranch(condLabel);

        // Condition block
        this.emitter.emitLabel(condLabel);
        const condition = this.visitExpression(node.expression);
        const condReg = this.ensureBooleanCondition(condition);
        this.emitter.emitConditionalBranch(condReg, bodyLabel, endLabel);

        // Body block
        this.emitter.emitLabel(bodyLabel);
        this.visitStatement(node.statement);
        this.emitter.emitBranch(condLabel);

        // End label
        this.emitter.emitLabel(endLabel);
    }

    /**
     * Process a for statement (lower to while)
     * 
     * for (init; cond; update) { body }
     * becomes:
     *   init
     *   while (cond) { body; update; }
     */
    private visitForStatement(node: ts.ForStatement): void {
        // Process initializer
        if (node.initializer) {
            if (ts.isVariableDeclarationList(node.initializer)) {
                for (const decl of node.initializer.declarations) {
                    this.visitVariableDeclaration(decl);
                }
            } else {
                this.visitExpression(node.initializer);
            }
        }

        const condLabel = this.context.nextLabel("for.cond");
        const bodyLabel = this.context.nextLabel("for.body");
        const endLabel = this.context.nextLabel("for.end");

        // Jump to condition check
        this.emitter.emitBranch(condLabel);

        // Condition block
        this.emitter.emitLabel(condLabel);
        if (node.condition) {
            const condition = this.visitExpression(node.condition);
            const condReg = this.ensureBooleanCondition(condition);
            this.emitter.emitConditionalBranch(condReg, bodyLabel, endLabel);
        } else {
            // No condition = infinite loop (true)
            this.emitter.emitBranch(bodyLabel);
        }

        // Body block
        this.emitter.emitLabel(bodyLabel);
        this.visitStatement(node.statement);

        // Incrementer
        if (node.incrementor) {
            this.visitExpression(node.incrementor);
        }
        this.emitter.emitBranch(condLabel);

        // End label
        this.emitter.emitLabel(endLabel);
    }

    /**
     * Ensure a value is an i1 boolean (for branch conditions)
     */
    private ensureBooleanCondition(value: string): string {
        // If the value is already a comparison result (i1), use it directly
        // Otherwise, compare with 0 to get a boolean
        // For simplicity, we'll assume comparisons return i1 and other values need comparison

        // Check if it's a numeric literal
        if (/^-?\d+$/.test(value)) {
            const resultReg = this.context.nextTemp();
            this.emitter.emitLine(`${resultReg} = icmp ne i32 ${value}, 0`);
            return resultReg;
        }

        // For register values, assume they might need conversion
        // In a more complete implementation, we'd track types
        return value;
    }

    /**
     * Process an expression and return its LLVM representation (value or register)
     */
    private visitExpression(node: ts.Expression): string {
        if (ts.isNumericLiteral(node)) {
            return node.getText(this.sourceFile);
        }

        if (ts.isParenthesizedExpression(node)) {
            return this.visitExpression(node.expression);
        }

        if (ts.isIdentifier(node)) {
            return this.visitIdentifier(node);
        }

        if (ts.isBinaryExpression(node)) {
            return this.visitBinaryExpression(node);
        }

        if (ts.isPrefixUnaryExpression(node)) {
            return this.visitPrefixUnaryExpression(node);
        }

        if (ts.isCallExpression(node)) {
            return this.visitCallExpression(node);
        }

        if (ts.isStringLiteral(node)) {
            return this.visitStringLiteral(node);
        }

        if (ts.isElementAccessExpression(node)) {
            return this.visitElementAccessExpression(node);
        }

        throw new Error(`Unsupported expression type: ${ts.SyntaxKind[node.kind]}`);
    }

    /**
     * Process a function call expression
     */
    private visitCallExpression(node: ts.CallExpression): string {
        // Get function name
        const funcExpr = node.expression;
        if (!ts.isIdentifier(funcExpr)) {
            throw new Error("Only direct function calls are supported");
        }

        const funcName = funcExpr.getText(this.sourceFile);

        // Check if this is an external function
        const externFunc = this.externFunctions.get(funcName);

        if (!externFunc) {
            throw new Error(`Unknown function: ${funcName}`);
        }

        // Process arguments
        const args: string[] = [];
        const argTypes: string[] = [];

        for (let i = 0; i < node.arguments.length; i++) {
            const arg = node.arguments[i];
            const value = this.visitExpression(arg);

            // Determine argument type
            let argType = "i32";  // Default
            if (i < externFunc.params.length) {
                argType = externFunc.params[i].type;
            } else if (ts.isStringLiteral(arg)) {
                argType = "i8*";
            }

            args.push(`${argType} ${value}`);
            argTypes.push(argType);
        }

        const argsStr = args.join(", ");
        const resultReg = this.context.nextTemp();

        // Emit the call
        if (externFunc.isVariadic) {
            this.emitter.emitVariadicCall(
                externFunc.returnType !== "void" ? resultReg : null,
                externFunc.returnType,
                funcName,
                argsStr
            );
        } else {
            this.emitter.emitCall(
                externFunc.returnType !== "void" ? resultReg : null,
                externFunc.returnType,
                funcName,
                argsStr
            );
        }

        return externFunc.returnType !== "void" ? resultReg : "0";
    }

    /**
     * Process a string literal
     */
    private visitStringLiteral(node: ts.StringLiteral): string {
        // Get the string value (without quotes)
        const value = node.text;

        // Add to string constants and get the global name
        const { name, length } = this.emitter.addStringConstant(value);

        // Generate a getelementptr to get the i8* pointer
        const resultReg = this.context.nextTemp();
        this.emitter.emitGetElementPtr(
            resultReg,
            `[${length} x i8]`,
            `[${length} x i8]*`,
            name,
            "i32 0, i32 0"
        );

        return resultReg;
    }

    /**
     * Process an element access expression (array[index])
     * 
     * For reading: arr[i] loads the value at that index
     * Uses getelementptr to compute the address, then load
     */
    private visitElementAccessExpression(node: ts.ElementAccessExpression): string {
        // Get the array base pointer
        const arrayExpr = node.expression;
        let basePtr: string;
        let baseType = "i32";  // Default element type

        if (ts.isIdentifier(arrayExpr)) {
            const name = arrayExpr.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);
            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }
            // Load the pointer value from the variable
            basePtr = this.context.nextTemp();
            this.emitter.emitLoad(basePtr, variable.llvmType, variable.llvmName);

            // Extract element type from pointer type (e.g., "i32*" -> "i32")
            if (variable.llvmType.endsWith("*")) {
                baseType = variable.llvmType.slice(0, -1);
            }
        } else {
            basePtr = this.visitExpression(arrayExpr);
        }

        // Get the index
        if (!node.argumentExpression) {
            throw new Error("Array access requires an index");
        }
        const index = this.visitExpression(node.argumentExpression);

        // Compute element address using getelementptr
        const elemPtr = this.context.nextTemp();
        this.emitter.emitLine(`${elemPtr} = getelementptr ${baseType}, ${baseType}* ${basePtr}, i32 ${index}`);

        // Load the value at that address
        const resultReg = this.context.nextTemp();
        this.emitter.emitLoad(resultReg, baseType, elemPtr);

        return resultReg;
    }

    /**
     * Get the element pointer for an array access (for assignment)
     */
    private getElementPointer(node: ts.ElementAccessExpression): { ptr: string; type: string } {
        const arrayExpr = node.expression;
        let basePtr: string;
        let baseType = "i32";

        if (ts.isIdentifier(arrayExpr)) {
            const name = arrayExpr.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);
            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }
            basePtr = this.context.nextTemp();
            this.emitter.emitLoad(basePtr, variable.llvmType, variable.llvmName);

            if (variable.llvmType.endsWith("*")) {
                baseType = variable.llvmType.slice(0, -1);
            }
        } else {
            basePtr = this.visitExpression(arrayExpr);
        }

        if (!node.argumentExpression) {
            throw new Error("Array access requires an index");
        }
        const index = this.visitExpression(node.argumentExpression);

        const elemPtr = this.context.nextTemp();
        this.emitter.emitLine(`${elemPtr} = getelementptr ${baseType}, ${baseType}* ${basePtr}, i32 ${index}`);

        return { ptr: elemPtr, type: baseType };
    }


    /**
     * Process an identifier (variable reference)
     */
    private visitIdentifier(node: ts.Identifier): string {
        const name = node.getText(this.sourceFile);
        const variable = this.context.lookupVariable(name);

        if (!variable) {
            throw new Error(`Undefined variable: ${name}`);
        }

        // Load the value from the stack-allocated variable
        const tempReg = this.context.nextTemp();
        this.emitter.emitLoad(tempReg, variable.llvmType, variable.llvmName);
        return tempReg;
    }

    /**
     * Process a binary expression (a + b, x * y, etc.)
     */
    private visitBinaryExpression(node: ts.BinaryExpression): string {
        const left = this.visitExpression(node.left);
        const right = this.visitExpression(node.right);

        const operatorToken = node.operatorToken.kind;
        const resultReg = this.context.nextTemp();

        // Determine type (for now, default to i32)
        const llvmType = "i32";

        // Handle assignment
        if (operatorToken === ts.SyntaxKind.EqualsToken) {
            return this.visitAssignment(node);
        }

        // Handle arithmetic operators
        const op = this.getOperatorString(operatorToken);

        if (this.isComparisonOperator(operatorToken)) {
            const { instruction, predicate } = TypeMapper.getCompareOp(op, llvmType);
            this.emitter.emitLine(`${resultReg} = ${instruction} ${predicate} ${llvmType} ${left}, ${right}`);
        } else {
            const llvmOp = TypeMapper.getBinaryOp(op, llvmType);
            this.emitter.emitBinaryOp(resultReg, llvmOp, llvmType, left, right);
        }

        return resultReg;
    }

    /**
     * Process an assignment expression
     */
    private visitAssignment(node: ts.BinaryExpression): string {
        const value = this.visitExpression(node.right);

        // Handle array element assignment: arr[i] = value
        if (ts.isElementAccessExpression(node.left)) {
            const { ptr, type } = this.getElementPointer(node.left);
            this.emitter.emitStore(type, value, ptr);
            return value;
        }

        // Handle identifier assignment: x = value
        if (ts.isIdentifier(node.left)) {
            const name = node.left.getText(this.sourceFile);
            const variable = this.context.lookupVariable(name);

            if (!variable) {
                throw new Error(`Undefined variable: ${name}`);
            }

            this.emitter.emitStore(variable.llvmType, value, variable.llvmName);
            return value;
        }

        throw new Error("Assignment target must be an identifier or array element");
    }

    /**
     * Process a prefix unary expression (-x, !x)
     */
    private visitPrefixUnaryExpression(node: ts.PrefixUnaryExpression): string {
        const operand = this.visitExpression(node.operand);
        const resultReg = this.context.nextTemp();

        switch (node.operator) {
            case ts.SyntaxKind.MinusToken:
                // Negate: 0 - x
                this.emitter.emitBinaryOp(resultReg, "sub", "i32", "0", operand);
                return resultReg;
            case ts.SyntaxKind.ExclamationToken:
                // Logical not: x == 0
                this.emitter.emitLine(`${resultReg} = icmp eq i32 ${operand}, 0`);
                return resultReg;
            default:
                throw new Error(`Unsupported prefix operator: ${ts.SyntaxKind[node.operator]}`);
        }
    }

    /**
     * Get the string representation of an operator
     */
    private getOperatorString(kind: ts.SyntaxKind): string {
        switch (kind) {
            case ts.SyntaxKind.PlusToken: return "+";
            case ts.SyntaxKind.MinusToken: return "-";
            case ts.SyntaxKind.AsteriskToken: return "*";
            case ts.SyntaxKind.SlashToken: return "/";
            case ts.SyntaxKind.PercentToken: return "%";
            case ts.SyntaxKind.LessThanToken: return "<";
            case ts.SyntaxKind.GreaterThanToken: return ">";
            case ts.SyntaxKind.LessThanEqualsToken: return "<=";
            case ts.SyntaxKind.GreaterThanEqualsToken: return ">=";
            case ts.SyntaxKind.EqualsEqualsToken: return "==";
            case ts.SyntaxKind.EqualsEqualsEqualsToken: return "===";
            case ts.SyntaxKind.ExclamationEqualsToken: return "!=";
            case ts.SyntaxKind.ExclamationEqualsEqualsToken: return "!==";
            default:
                throw new Error(`Unknown operator: ${ts.SyntaxKind[kind]}`);
        }
    }

    /**
     * Check if an operator is a comparison operator
     */
    private isComparisonOperator(kind: ts.SyntaxKind): boolean {
        return [
            ts.SyntaxKind.LessThanToken,
            ts.SyntaxKind.GreaterThanToken,
            ts.SyntaxKind.LessThanEqualsToken,
            ts.SyntaxKind.GreaterThanEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(kind);
    }

    /**
     * Get the return type of a function
     */
    private getReturnType(node: ts.FunctionDeclaration): string {
        if (node.type) {
            return node.type.getText(this.sourceFile);
        }

        // Try to infer from type checker
        const signature = this.typeChecker.getSignatureFromDeclaration(node);
        if (signature) {
            const returnType = this.typeChecker.getReturnTypeOfSignature(signature);
            return this.typeChecker.typeToString(returnType);
        }

        return "void";
    }
}

/**
 * Compile a TypeScript source file to LLVM IR
 */
export function compileToIR(sourceFilePath: string): string {
    // Create a program with just this file
    // We use minimal options since MicroTS handles its own type mapping
    const program = ts.createProgram([sourceFilePath], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: false,  // We do our own type checking
        skipLibCheck: true,
        skipDefaultLibCheck: true,
    });

    const sourceFile = program.getSourceFile(sourceFilePath);

    if (!sourceFile) {
        throw new Error(`Could not load source file: ${sourceFilePath}`);
    }

    // Only check for syntax errors, not semantic errors
    // MicroTS has its own type system (maps to LLVM types)
    const syntaxDiagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (syntaxDiagnostics.length > 0) {
        const messages = syntaxDiagnostics.map((d) => {
            const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
            if (d.file && d.start !== undefined) {
                const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
                return `${d.file.fileName}:${line + 1}:${character + 1}: ${message}`;
            }
            return message;
        });
        throw new Error(`Syntax errors:\n${messages.join("\n")}`);
    }

    // Extract module name from file path
    const moduleName = sourceFilePath.split("/").pop()?.replace(".ts", "") || "module";

    // Walk the AST and generate IR
    const walker = new ASTWalker(sourceFile, program, moduleName);
    return walker.walk();
}
