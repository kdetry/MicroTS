interface Point {
    x: number;
    y: number;
}

interface Line {
    start: Point;
    end: Point;
}

// Vector3 interface - maps to LLVM struct
interface Vector3 {
    x: number;
    y: number;
    z: number;
}

function main(): number {
    printf("=== Struct Example ===\\n\\n");

    // Allocate a Vector3 on the heap
    let vec: Vector3 = malloc(sizeof<Vector3>());

    // Set field values
    vec.x = 10;
    vec.y = 20;
    vec.z = 30;

    // Read and print field values
    printf("vec.x = %d\\n", vec.x);
    printf("vec.y = %d\\n", vec.y);
    printf("vec.z = %d\\n", vec.z);

    // Compute sum
    let sum: number = vec.x + vec.y + vec.z;
    printf("\\nSum: %d\\n", sum);

    // Clean up
    free(vec);

    let line: Line = malloc(sizeof<Line>());
    line.start.x = 1;
    line.start.y = 2;
    line.end.x = 3;
    line.end.y = 4;

    printf("line.start.x = %d\\n", line.start.x);
    printf("line.start.y = %d\\n", line.start.y);
    printf("line.end.x = %d\\n", line.end.x);
    printf("line.end.y = %d\\n", line.end.y);

    free(line);

    return sum;  // Expected: 60
}
