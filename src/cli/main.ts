const [, , ...args] = process.argv;

if (args.length === 0) {
  console.log("drime-s3 scaffold");
  process.exit(0);
}

if (args[0] === "serve") {
  console.log("drime-s3 scaffold");
  process.exit(0);
}

console.error(`Unknown command: ${args.join(" ")}`);
process.exit(1);
