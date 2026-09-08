import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "convex-telnyx-consumer-"));
function run(command, args, cwd = root) {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10_000_000,
  });
  if (r.status !== 0)
    throw new Error(`${command} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const packed = JSON.parse(
  run("npm", ["pack", "--json", "--pack-destination", temp]),
);
const files = packed[0].files.map((x) => x.path);
for (const path of files) {
  if (/(^|\/)(node_modules|\.env[^/]*|\.convex|tests)(\/|$)|\.tgz$/.test(path))
    throw new Error(`Unexpected package file: ${path}`);
}
for (const path of [
  "dist/client/index.js",
  "dist/component/convex.config.js",
  "dist/component/_generated/component.d.ts",
  "src/test.ts",
  "dist/sdk.js",
  "LICENSE",
  "README.md",
]) {
  if (!files.includes(path)) throw new Error(`Missing package entry: ${path}`);
}
const versions = Object.fromEntries(
  ["typescript", "vitest", "convex-test"].map((name) => [
    name,
    JSON.parse(readFileSync(join(root, "node_modules", name, "package.json")))
      .version,
  ]),
);
writeFileSync(
  join(temp, "package.json"),
  JSON.stringify({
    name: "telnyx-consumer-check",
    private: true,
    type: "module",
    devDependencies: versions,
  }),
);
run(
  "npm",
  [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(temp, packed[0].filename),
  ],
  temp,
);
writeFileSync(
  join(temp, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ["consumer.ts"],
  }),
);
writeFileSync(
  join(temp, "consumer.ts"),
  `import {Telnyx, type CallCommandParams} from "convex-telnyx";\nimport component from "convex-telnyx/convex.config";\nimport type {ComponentApi} from "convex-telnyx/_generated/component.js";\nimport {createTelnyxSDK} from "convex-telnyx/sdk";\nimport {defineApp} from "convex/server";\nconst app=defineApp();app.use(component);\ndeclare const api:ComponentApi;new Telnyx(api);\nconst p:CallCommandParams<"speak">={payload:"hello",voice:"female"};\ncreateTelnyxSDK({apiKey:"not-a-real-key"});\nvoid p;\n`,
);
run(join(temp, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], temp);
writeFileSync(
  join(temp, "consumer.test.ts"),
  `import {it,expect} from "vitest";\nimport {convexTest} from "convex-test";\nimport {defineSchema,componentsGeneric} from "convex/server";\nimport telnyx from "convex-telnyx/test";\nit("registers the packaged component and nested dependencies",async()=>{const t=convexTest(defineSchema({}),{"./_generated/api.ts":async()=>({})});telnyx.register(t);const c=componentsGeneric();const result=await t.query(c.telnyx.resources.list,{scope:"test",kind:"call",paginationOpts:{cursor:null,numItems:10}});expect(result.page).toEqual([]);});\n`,
);
run(join(temp, "node_modules/.bin/vitest"), ["run", "consumer.test.ts"], temp);
run(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    'import {Telnyx} from "convex-telnyx"; import {createTelnyxSDK} from "convex-telnyx/sdk"; if(!Telnyx || !createTelnyxSDK({apiKey:"test-key"})) throw new Error("exports missing")',
  ],
  temp,
);
// Convex config is bundled by the Convex CLI. Check that actual resolution path;
// upstream Workpool dependencies intentionally rely on bundler-style imports.
writeFileSync(
  join(temp, "config-smoke.ts"),
  'import c from "convex-telnyx/convex.config.js"; if (!c) throw new Error("config missing");',
);
run(
  join(temp, "node_modules/.bin/esbuild"),
  [
    "config-smoke.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--outfile=config-smoke.mjs",
  ],
  temp,
);
// Runtime evaluation requires Convex componentDefinitionPath injection.
// The example deployment smoke check covers that step.
if (!existsSync(join(temp, packed[0].filename)))
  throw new Error("Archive missing");
console.log(
  JSON.stringify(
    {
      ok: true,
      archive: join(temp, packed[0].filename),
      fileCount: files.length,
      unpackedSize: packed[0].unpackedSize,
      consumer: temp,
    },
    null,
    2,
  ),
);
