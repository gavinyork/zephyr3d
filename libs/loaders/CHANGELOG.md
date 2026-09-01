# Change Log - @zephyr3d/loaders

This log was last generated on Tue, 01 Sep 2026 07:54:12 GMT and should not be manually modified.

## 0.1.5
Tue, 01 Sep 2026 07:54:12 GMT

### Patches

- Add an Alembic model loader.
- Support importing Cem Yuksel's hair models (.hair), including origin options.
- A batch of FBX import fixes: unify skeletons into a single main rig, import bone TRS animation aligned with the bind pose, correct skin bind matrix computation, stop creating duplicate joint nodes, fix global unit conversion, fix UV channels and texture coordinates, fix bind pose for complex skeletons, fix lost morph targets, preserve original mesh material texture names, fix lost HairRoot local pose, and fix hair child-bone rest pose.
- Fix vertex corruption with multi-weight skinning (#29).

## 0.1.4
Sat, 04 Jul 2026 17:00:36 GMT

### Patches

- Fix humanoid mapping for VRM0.0

## 0.1.3
Tue, 30 Jun 2026 20:07:17 GMT

### Patches

- Switch API reference from api-documenter to TypeDoc

## 0.1.2
Tue, 23 Jun 2026 16:50:23 GMT

### Patches

- Support loading of .vrma files

## 0.1.1
Thu, 04 Jun 2026 07:58:17 GMT

### Patches

- Initial commit

