// Rect interface
interface Rect {
    width: number;
    height: number;
}

// Method with "this" parameter - UFCS syntax
function area(this: Rect): number {
    return this.width * this.height;
}

function scale(this: Rect, factor: number): void {
    this.width = this.width * factor;
    this.height = this.height * factor;
}

function main(): number {
    printf("=== Method Syntax (UFCS) ===\\n\\n");

    let r: Rect = malloc(sizeof<Rect>());
    r.width = 10;
    r.height = 20;

    printf("Initial: %d x %d\\n", r.width, r.height);
    printf("Area: %d\\n\\n", r.area());

    // Scale by 2: 20 x 40
    r.scale(2);

    printf("After scale(2): %d x %d\\n", r.width, r.height);

    let a: number = r.area();
    printf("Final Area: %d\\n", a);

    free(r);
    return a;  // Expected: 800 (20 * 40)
}
