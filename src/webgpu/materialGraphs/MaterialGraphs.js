/** @import { Material } from 'three/webgpu' */
import { GRAPH_OUTPUTS, getRunMaterialGraphFn } from './materialGraph.wgsl.js';

/**
 * The TSL graphs of node materials, built into the kernels by three.js as the WGSL function from `getRunFn`. Each
 * material with a graph for a surface input in `GRAPH_OUTPUTS` gets a graph index, stored in its material struct.
 */
export class MaterialGraphs {

	constructor() {

		this.graphs = [];
		this.indices = new Map();
		this.runFn = getRunMaterialGraphFn( [] );

	}

	/**
	 * Collects the graphs of the materials. Returns whether they changed, so the function from `getRunFn` did and the
	 * kernels need rebuilding. Changed uniform values don't need a rebuild.
	 *
	 * @param {Array<Material>} materials
	 * @returns {boolean}
	 */
	update( materials ) {

		const graphs = [];
		const indices = new Map();
		materials.forEach( material => {

			if ( ! material.isNodeMaterial ) {

				return;

			}

			const outputs = GRAPH_OUTPUTS
				.filter( ( { key } ) => material[ key ] )
				.map( output => ( { ...output, node: material[ output.key ] } ) );

			if ( outputs.length > 0 ) {

				indices.set( material, graphs.length );
				graphs.push( outputs );

			}

		} );

		const changed = ! areGraphsEqual( graphs, this.graphs );
		this.graphs = graphs;
		this.indices = indices;
		if ( changed ) {

			this.runFn = getRunMaterialGraphFn( graphs );

		}

		return changed;

	}

	/**
	 * Returns the index of the material's graphs, or -1 without any.
	 *
	 * @param {Material} material
	 * @returns {number}
	 */
	getIndex( material ) {

		return this.indices.get( material ) ?? - 1;

	}

	/**
	 * Returns the WGSL function running a material's graphs. Get it again when `update` returns true.
	 *
	 * @returns {Function}
	 */
	getRunFn() {

		return this.runFn;

	}

}

// whether two lists of graphs have the same outputs, with the same nodes
function areGraphsEqual( a, b ) {

	return a.length === b.length && a.every( ( outputs, i ) => {

		return outputs.length === b[ i ].length && outputs.every( ( output, j ) => output.node === b[ i ][ j ].node && output.name === b[ i ][ j ].name );

	} );

}
