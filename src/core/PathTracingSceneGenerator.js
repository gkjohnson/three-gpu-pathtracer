import { Mesh } from 'three';
import { SAH, MeshBVH } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';
import { StaticGeometryGenerator } from 'three-mesh-bvh';

export class PathTracingSceneGenerator {

	constructor() {

		this.bvhGenerator = new GenerateMeshBVHWorker();
		this.synchronous = false;

	}

	generate( scene, options = {} ) {

		const { bvhGenerator, synchronous } = this;
		const meshes = [];

		scene.traverse( c => {

			if ( c.isSkinnedMesh || c.isMesh && c.morphTargetInfluences ) {

				const generator = new StaticGeometryGenerator( c );
				generator.applyWorldTransforms = false;
				const mesh = new Mesh(
					generator.generate(),
					c.material,
				);
				mesh.matrixWorld.copy( c.matrixWorld );
				mesh.matrix.copy( c.matrixWorld );
				mesh.matrix.decompose( mesh.position, mesh.quaternion, mesh.scale );
				meshes.push( mesh );

			} else if ( c.isMesh ) {

				meshes.push( c );

			}

		} );

		const { geometry, materials, textures } = mergeMeshes( meshes, { attributes: [ 'position', 'normal', 'tangent', 'uv' ] } );


		const bvhOptions = { strategy: SAH, ...options, maxLeafTris: 1 };
		if ( synchronous ) {

			return {
				scene,
				materials,
				textures,
				bvh: new MeshBVH( geometry, bvhOptions ),
			};

		} else {

			const bvhPromise = bvhGenerator.generate( geometry, bvhOptions );
			return bvhPromise.then( bvh => {

				return {
					scene,
					materials,
					textures,
					bvh,
				};

			} );

		}



	}

	dispose() {

		this.bvhGenerator.terminate();

	}

}
