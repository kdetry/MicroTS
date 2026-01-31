// utils.ts - Utility functions for main program
// This file contains helper functions

function add(a: number, b: number): number {
    return a + b;
}

function multiply(a: number, b: number): number {
    return a * b;
}

function factorial(n: number): number {
    let result: number = 1;
    for (let i: number = 1; i <= n; i = i + 1) {
        result = result * i;
    }
    return result;
}
