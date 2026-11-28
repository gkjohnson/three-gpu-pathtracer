/** @import { Camera, Material } from 'three/webgpu' */
import { Matrix3, Matrix4, StorageBufferAttribute, Vector3 } from 'three/webgpu';
import {
	storage, uniform, cameraViewMatrix, cameraWorldMatrix, cameraNormalMatrix, cameraPosition, cameraProjectionMatrix,
	cameraProjectionMatrixInverse, cameraNear, cameraFar,
} from 'three/tsl';
import { GRAPH_OUTPUTS, getEvaluateMaterialGraphFn } from './materialGraph.wgsl.js';

/**
 * Builds the TSL graphs of node materials into the kernels with three.js. Assigned to a shading model with
 * `setMaterialGraphs`, which passes it the materials with `update`. The path tracer passes it the camera with
 * `updateCamera`.
 *
 * The surface record calls the WGSL function from `getEvaluateFn` at each hit, which replaces the surface inputs in
 * "result" that the hit's material has graphs for, listed in `GRAPH_OUTPUTS`:
 * `fn evaluateMaterialGraph( hit, vertexData, shadingNormal: vec3f, view: vec3f, result: ptr<function, MaterialGraphResult> )`
 * "shadingNormal" is the normal on the side hit after the material's normal maps, and "view" the direction the ray
 * came from.
 */
export class MaterialGraphs {

	constructor() {

		// each material with graphs and its "outputs", each a "GRAPH_OUTPUTS" entry with its graph's "node"
		this.graphs = [];
		this.evaluateFn = null;

		// the uniforms replacing three.js' camera nodes, by node
		this.cameraUniforms = new Map( [
			[ cameraViewMatrix, uniform( new Matrix4() ) ],
			[ cameraWorldMatrix, uniform( new Matrix4() ) ],
			[ cameraNormalMatrix, uniform( new Matrix3() ) ],
			[ cameraPosition, uniform( new Vector3() ) ],
			[ cameraProjectionMatrix, uniform( new Matrix4() ) ],
			[ cameraProjectionMatrixInverse, uniform( new Matrix4() ) ],
			[ cameraNear, uniform( 0 ) ],
			[ cameraFar, uniform( 0 ) ],
		] );

		// the index in "graphs" of each material by its index in the shading model, or -1 without graphs. At least
		// two long so TSL doesn't make it a scalar
		this.graphIndices = storage( new StorageBufferAttribute( new Int32Array( 2 ).fill( - 1 ), 1 ), 'int' )
			.toReadOnly()
			.setName( 'materialGraphIndices' );

	}

	/**
	 * Sets the camera the graphs read, like three.js' "cameraPosition". Changing it doesn't need a rebuild.
	 *
	 * @param {Camera} camera
	 */
	updateCamera( camera ) {

		const { cameraUniforms } = this;
		cameraUniforms.get( cameraViewMatrix ).value.copy( camera.matrixWorldInverse );
		cameraUniforms.get( cameraWorldMatrix ).value.copy( camera.matrixWorld );
		cameraUniforms.get( cameraNormalMatrix ).value.getNormalMatrix( camera.matrixWorldInverse );
		cameraUniforms.get( cameraPosition ).value.setFromMatrixPosition( camera.matrixWorld );
		cameraUniforms.get( cameraProjectionMatrix ).value.copy( camera.projectionMatrix );
		cameraUniforms.get( cameraProjectionMatrixInverse ).value.copy( camera.projectionMatrixInverse );
		cameraUniforms.get( cameraNear ).value = camera.near ?? 0;
		cameraUniforms.get( cameraFar ).value = camera.far ?? 0;

	}

	/**
	 * Collects the graphs of the materials, in the shading model's order. Returns whether they changed, so the
	 * function from `getEvaluateFn` did and the kernels need rebuilding. Changed uniform values don't need a rebuild.
	 *
	 * @param {Array<Material>} materials
	 * @returns {boolean}
	 */
	update( materials ) {

		const graphs = [];
		const indices = new Int32Array( Math.max( materials.length, 2 ) ).fill( - 1 );
		materials.forEach( ( material, i ) => {

			if ( ! material.isNodeMaterial ) {

				return;

			}

			const outputs = GRAPH_OUTPUTS
				.filter( ( { key } ) => material[ key ] )
				.map( output => ( { ...output, node: material[ output.key ] } ) );

			if ( outputs.length > 0 ) {

				indices[ i ] = graphs.length;
				graphs.push( { material, outputs } );

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

			this.evaluateFn = getEvaluateMaterialGraphFn( graphs, this.graphIndices, this.cameraUniforms );

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
		return material === b[ i ].material && outputs.length === other.length && outputs.every( ( output, j ) => output.node === other[ j ].node && output.name === other[ j ].name );

	} );

}
