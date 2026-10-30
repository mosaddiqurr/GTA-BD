import { AbstractMesh, AssetContainer, LoadAssetContainerAsync, Mesh, Node, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

export interface Anchor {
  position: Vector3;
}

/** A GLB ready for static instancing: every mesh is baked to world identity, so thin
 *  instances need no parent and no handedness flip. */
export interface StaticAsset {
  id: string;
  meshes: Mesh[];
  anchors: Map<string, Vector3>;
  /** Height of the bounding box, from the ground. */
  height: number;
  radius: number;
}

const staticCache = new Map<string, Promise<StaticAsset | null>>();
const containerCache = new Map<string, Promise<AssetContainer | null>>();

export function loadContainer(scene: Scene, url: string): Promise<AssetContainer | null> {
  let p = containerCache.get(url);
  if (!p) {
    // Assets are optional at runtime: a missing file must degrade, never black-screen.
    p = LoadAssetContainerAsync(url, scene, { pluginExtension: ".glb" }).catch((err) => {
      console.warn(`[assets] could not load ${url}`, err?.message ?? err);
      return null;
    });
    containerCache.set(url, p);
  }
  return p;
}

export function loadStatic(scene: Scene, url: string, id: string): Promise<StaticAsset | null> {
  let p = staticCache.get(url);
  if (!p) {
    p = loadContainer(scene, url).then((c) => (c ? bakeStatic(scene, c, id) : null));
    staticCache.set(url, p);
  }
  return p;
}

function bakeStatic(scene: Scene, c: AssetContainer, id: string): StaticAsset {
  c.addAllToScene();
  const root = c.meshes.find((m) => m.name === "__root__") ?? c.rootNodes[0];
  root?.computeWorldMatrix(true);
  const anchors = new Map<string, Vector3>();
  const collect = (n: Node): void => {
    if (n instanceof TransformNode) {
      n.computeWorldMatrix(true);
      if (!(n instanceof AbstractMesh) && n !== root) anchors.set(n.name, n.getAbsolutePosition().clone());
    }
    n.getChildren().forEach(collect);
  };
  if (root) collect(root);
  const meshes: Mesh[] = [];
  let maxY = 0;
  let radius = 0;
  for (const m of c.meshes) {
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
    m.computeWorldMatrix(true);
    const world = m.getWorldMatrix().clone();
    m.setParent(null);
    m.position.setAll(0);
    m.rotationQuaternion = null;
    m.rotation.setAll(0);
    m.scaling.setAll(1);
    m.computeWorldMatrix(true);
    m.bakeTransformIntoVertices(world);
    m.refreshBoundingInfo();
    const box = m.getBoundingInfo().boundingBox;
    maxY = Math.max(maxY, box.maximumWorld.y);
    radius = Math.max(radius, Math.hypot(box.extendSizeWorld.x, box.extendSizeWorld.z));
    m.isPickable = false;
    m.isVisible = false; // only per-tile clones are drawn
    m.setEnabled(false);
    meshes.push(m);
  }
  root?.dispose(true, false);
  return { id, meshes, anchors, height: maxY, radius };
}
