/** @import { Camera, Material, Texture } from 'three/webgpu' */
import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import {
	GRAPH_OUTPUTS, createCameraUniforms, getApplyMaterialGraphFn, getRunMaterialGraphFn, updateCameraUniforms,
} from './materialGraph.wgsl.js';

/**
 * The TSL graphs of node materials, built into the kernels by three.js. Assigned to a shading model with
 * `setMaterialGraphs`, whose surface record calls the WGSL function from `getApplyFn` to replace the surface inputs a
 * material has graphs for in `GRAPH_OUTPUTS`.
 */
export class MaterialGraphs {

	constructor() {

		this.graphs = [];
		this.sampleTexel = null;
		this.cameraUniforms = createCameraUniforms();

		// the graph index of each material by its index in the shading model, or -1 without graphs. At least two long
		// so TSL doesn't make it a scalar
		this.graphIndices = storage( new StorageBufferAttribute( new Int32Array( 2 ).fill( - 1 ), 1 ), 'int' )
			.toReadOnly()
			.setName( 'materialGraphIndices' );
		this.applyFn = this.getApplyMaterialGraphFn();

	}

	/**
	 * Sets the camera the graphs read, like three.js' "cameraPosition". Changing it doesn't need a rebuild.
	 *
	 * @param {Camera} camera
	 */
	updateCamera( camera ) {

		updateCameraUniforms( this.cameraUniforms, camera );

	}

	/**
	 * Collects the graphs of the materials, in the shading model's order. Returns whether they changed, so the function
	 * from `getApplyFn` did and the kernels need rebuilding. Changed uniform values don't need a rebuild. "addTexture"
	 * adds a texture a graph samples to the texture atlas, returning the descriptor "sampleTexel" samples it with.
	 *
	 * @param {Array<Material>} materials
	 * @param {Object} textures
	 * @param {function(Texture):number} textures.addTexture
	 * @param {Function} textures.sampleTexel
	 * @returns {boolean}
	 */
	update( materials, { addTexture, sampleTexel } ) {

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

				// the descriptor each texture node is sampled with from the atlas
				const textures = new Map();
				getTextureNodes( outputs ).forEach( node => textures.set( node, addTexture( node.value ) ) );

				indices[ i ] = graphs.length;
				graphs.push( { material, outputs, textures } );

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

		const changed = sampleTexel !== this.sampleTexel || ! areGraphsEqual( graphs, this.graphs );
		this.graphs = graphs;
		this.sampleTexel = sampleTexel;
		if ( changed ) {

			this.applyFn = this.getApplyMaterialGraphFn();

		}

		return changed;

	}

	/**
	 * Returns the WGSL function applying a hit's material graphs. Get it again when `update` returns true.
	 *
	 * @returns {Function}
	 */
	getApplyFn() {

		return this.applyFn;

	}

	// builds the function applying the current graphs
	getApplyMaterialGraphFn() {

		const runFn = getRunMaterialGraphFn( this.graphs, this.cameraUniforms, this.sampleTexel );
		return getApplyMaterialGraphFn( runFn, this.graphIndices );

	}

}

// whether two lists of graphs have the same materials and outputs, with the same nodes, and sample the same textures
// with the same descriptors
function areGraphsEqual( a, b ) {

	return a.length === b.length && a.every( ( graph, i ) => {

		const other = b[ i ];
		const sameOutputs = graph.outputs.length === other.outputs.length && graph.outputs.every( ( output, j ) => {

			return output.node === other.outputs[ j ].node && output.name === other.outputs[ j ].name;

		} );

		const sameTextures = graph.textures.size === other.textures.size && [ ...graph.textures ].every( ( [ node, descriptor ] ) => {

			return other.textures.get( node ) === descriptor;

		} );

		return graph.material === other.material && sameOutputs && sameTextures;

	} );

}

// the texture nodes the outputs' graphs read, not counting those only created inside TSL function bodies
function getTextureNodes( outputs ) {

	const textures = new Set();
	const seen = new Set();
	const traverse = node => {

		if ( ! node || ! node.isNode || seen.has( node ) ) {

			return;

		}

		seen.add( node );
		if ( node.isTextureNode ) {

			textures.add( node );

		}

		for ( const child of node.getChildren() ) {

			traverse( child );

		}

	};

	outputs.forEach( ( { node } ) => traverse( node ) );
	return textures;

}
