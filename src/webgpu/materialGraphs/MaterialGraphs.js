/** @import { Material } from 'three/webgpu' */
import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import { getEvaluateMaterialGraphFn } from './materialGraph.wgsl.js';

/**
 * Builds the TSL graphs of node materials into the kernels with three.js. Assigned to a shading model with
 * `setMaterialGraphs`, which passes it the materials and the graph outputs its surface record supports with `update`.
 *
 * The surface record calls the WGSL function from `getEvaluateFn` at each hit, which replaces the fields of "surf" that
 * the hit's material has graphs for, and reads its "normal" as the shading normal:
 * `fn evaluateMaterialGraph( hit, vertexData, view: vec3f, surf: ptr<function, SurfaceRecord> )`
 * "view" is the direction the ray came from. The graphs read the camera from the kernel context's "camera".
 */
export class MaterialGraphs {

	constructor() {

		// each material with graphs and its "outputs", each the surface record "field" a graph sets, its "type" and the
		// graph's "node"
		this.graphs = [];
		this.evaluateFn = null;

		// the index in "graphs" of each material by its index in the shading model, or -1 without graphs. At least
		// two long so TSL doesn't make it a scalar
		this.graphIndices = storage( new StorageBufferAttribute( new Int32Array( 2 ).fill( - 1 ), 1 ), 'int' )
			.toReadOnly()
			.setName( 'materialGraphIndices' );

	}

	/**
	 * Collects the graphs of the materials, in the shading model's order, for the "outputs" its surface record
	 * supports: each node material "property" with the surface record "field" it sets and its "type". Returns whether
	 * they changed, so the function from `getEvaluateFn` did and the kernels need rebuilding. Changed uniform values
	 * don't need a rebuild.
	 *
	 * @param {Array<Material>} materials
	 * @param {Array<{property:string,field:string,type:string}>} outputs
	 * @returns {boolean}
	 */
	update( materials, outputs ) {

		const graphs = [];
		const indices = new Int32Array( Math.max( materials.length, 2 ) ).fill( - 1 );
		materials.forEach( ( material, i ) => {

			if ( ! material.isNodeMaterial ) {

				return;

			}

			const materialOutputs = outputs
				.filter( ( { property } ) => material[ property ] )
				.map( ( { property, field, type } ) => ( { field, type, node: material[ property ] } ) );

			if ( materialOutputs.length > 0 ) {

				indices[ i ] = graphs.length;
				graphs.push( { material, outputs: materialOutputs } );

			}

		} );

		const attribute = this.graphIndices.value;
		if ( attribute.count < indices.length ) {

			attribute.dispose();
			this.graphIndices.value = new StorageBufferAttribute( indices, 1 );

		} else {

			attribute.array.set( indices );
			attribute.needsUpdate = true;

		}

		const changed = this.evaluateFn === null || ! areGraphsEqual( graphs, this.graphs );
		this.graphs = graphs;
		if ( changed ) {

			this.evaluateFn = getEvaluateMaterialGraphFn( graphs, this.graphIndices );

		}

		return changed;

	}

	/**
	 * Returns the "evaluateMaterialGraph" WGSL function. Get it again when `update` returns true.
	 *
	 * @returns {Function}
	 */
	getEvaluateFn() {

		return this.evaluateFn;

	}

}

// whether two lists of graphs have the same materials and outputs, with the same nodes
function areGraphsEqual( a, b ) {

	return a.length === b.length && a.every( ( { material, outputs }, i ) => {

		const other = b[ i ].outputs;
		return material === b[ i ].material && outputs.length === other.length && outputs.every( ( output, j ) => output.node === other[ j ].node && output.field === other[ j ].field && output.type === other[ j ].type );

	} );

}
