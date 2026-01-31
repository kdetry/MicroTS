// Fibonacci with a proper while loop
declare function printf(format: string, ...args: number[]): number;

function main(): number {
    let n: number = 10;
    let a: number = 0;
    let b: number = 1;
    let i: number = 0;
    let temp: number = 0;

    // Calculate fib(n) using a while loop
    while (i < n) {
        temp = a + b;
        a = b;
        b = temp;
        i = i + 1;
    }

    printf("Fibonacci(%d) = %d\\n", n, b);
    return b;  // Should return 89 for fib(10)
}
