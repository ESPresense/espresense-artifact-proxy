import { Hono } from "hono";
import { cache } from "hono/cache";
import { Octokit } from 'octokit'

// We support the GET, POST, HEAD, and OPTIONS methods from any origin,
// and allow any header on requests. These headers must be present
// on all responses to all CORS preflight requests. In practice, this means
// all responses to OPTIONS requests.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
}

function esp32(path) {
  return {
    "chipFamily": "ESP32",
    "parts": [{
      "path": "/static/esp32/bootloader.bin",
      "offset": 4096
    },
    {
      "path": "/static/esp32/partitions.bin",
      "offset": 32768
    },
    {
      "path": "/static/boot_app0.bin",
      "offset": 57344
    },
    {
      "path": path,
      "offset": 65536
    }]
  };
}

function esp32c3(path) {
  return {
    "chipFamily": "ESP32-C3",
    "parts": [{
      "path": "/static/esp32c3/bootloader.bin",
      "offset": 0x0000
    },
    {
      "path": "/static/esp32c3/partitions.bin",
      "offset": 0x8000
    },
    {
      "path": "/static/boot_app0.bin",
      "offset": 0xe000
    },
    {
      "path": path,
      "offset": 0x10000
    }]
  };
}

function esp32s3(path) {
  return {
    "chipFamily": "ESP32-S3",
    "parts": [{
      "path": "/static/esp32s3/bootloader.bin",
      "offset": 0x0000
    },
    {
      "path": "/static/esp32s3/partitions.bin",
      "offset": 0x8000
    },
    {
      "path": "/static/boot_app0.bin",
      "offset": 0xe000
    },
    {
      "path": path,
      "offset": 0x10000
    }]
  };
}
function findAsset(rel, name) {
  var f = rel.filter((f2) => f2.name == name);
  return f.length ? f[0] : null;
}

var app = new Hono();
app.get("*", (0, cache)({ cacheName: "artifacts", cacheControl: "public, max-age=900" }));
var octokit = new Octokit({});
var artifacts = new Hono();
artifacts.use("*", (0, import_pretty_json.prettyJSON)());
artifacts.all("/latest/download/:branch/:bin", async (c) => {
  const branch = c.req.param("branch");
  const bin = c.req.param("bin");
  console.log({ branch, bin });
  var resp = await octokit.request("GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs", {
    owner: "ESPresense",
    repo: "ESPresense",
    workflow_id: "build.yml",
    status: "success",
    branch
  });
  for (let i = 0; i < resp.data.workflow_runs.length; i++) {
    const run_id = resp.data.workflow_runs[i].id;
    const sha = resp.data.workflow_runs[i].head_sha;
    return c.redirect(`/artifacts/download/runs/${run_id}/${sha.substring(0, 7)}/${bin}`);
  }
});
artifacts.all("/download/runs/:run_id/:sha/:bin", async (c) => {
  const run_id = parseInt(c.req.param("run_id"));
  const bin = c.req.param("bin");
  console.log({ run_id });
  var resp = await octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts", {
    owner: "ESPresense",
    repo: "ESPresense",
    run_id
  });
  let artifacts2 = resp.data.artifacts;
  const artifact = findAsset(artifacts2, bin);
  return c.redirect(`/artifacts/download/${artifact.id}/${bin}`);
});
artifacts.get("/download/:artifact_id/*", async (c) => {
  const artifact_id = parseInt(c.req.param("artifact_id"));
  console.log({ artifact_id });
  const artifact = await fetch(`https://nightly.link/ESPresense/ESPresense/actions/artifacts/${artifact_id}.zip`);
  if (artifact.status != 200)
    throw new Error(`Artifact ${artifact_id} status code ${artifact.status}`);
  const ab = await artifact.arrayBuffer();
  const arr = new Uint8Array(ab);
  const files = unzipSync(arr);
  for (const key in files) {
    if (Object.prototype.hasOwnProperty.call(files, key)) {
      return c.newResponse(files[key], 200, { "Content-Type": "application/octet-stream" });
    }
  }
});
artifacts.get("/:run_id_2{[0-9]+.json}", async (c) => {
  const flavor = c.req.query("flavor");
  const run_id = parseInt(c.req.param("run_id_2"));
  console.log({ flavor, run_id });
  var resp = await octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts", {
    owner: "ESPresense",
    repo: "ESPresense",
    run_id
  });
  let artifacts2 = resp.data.artifacts;
  let workflow_run = artifacts2[0].workflow_run;
  if (!workflow_run)
    throw new Error("No workflow run found");
  let manifest = {
    "name": "ESPresense " + workflow_run.head_branch + " branch" + (flavor && flavor != "" ? ` (${flavor})` : ""),
    "new_install_prompt_erase": true,
    "builds": []
  };
  var a32 = findAsset(artifacts2, `esp32-${flavor}.bin`) || findAsset(artifacts2, `${flavor}.bin`) || findAsset(artifacts2, `esp32.bin`);
  if (a32)
    manifest.builds.push(esp32(`download/${a32.id}/${a32.name}`));
  var c3 = findAsset(artifacts2, `esp32c3-${flavor}.bin`) || findAsset(artifacts2, `esp32c3.bin`);
  if (c3)
    manifest.builds.push(esp32c3(`download/${c3.id}/${c3.name}`));
  return c.json(manifest);
});
app.route("/artifacts", artifacts);

export default app;