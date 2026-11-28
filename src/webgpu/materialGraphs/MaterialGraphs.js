/** @import { Material } from 'three/webgpu' */
import { getEvaluateMaterialGraphFn } from './materialGraph.wgsl.js';

/**
 * Builds node materials' TSL graphs into the surface record. Set with `ShadingModel.setMaterialGraphs`.
 */
export class MaterialGraphs {

	constructor() {

		// each material with graphs and its outputs: the surface record "field", its "type" and the graph "node"
		this.graphs = [];
		this.graphIndices = new Map();

		// fn evaluateMaterialGraph( hit, vertexData, view, surf: ptr<function, SurfaceRecord> )
		this.evaluateFn = null;

	}

	/**
	 * Collects the materials' graphs for the shading model's outputs. Returns true if the kernels need rebuilding.
	 *
	 * @param {Array<Material>} materials
	 * @param {Array<{property:string,field:string,type:string}>} outputs
	 * @returns {boolean}
	 */
	update( materials, outputs ) {

		const graphs = [];
		this.graphIndices.clear();
		materials.forEach( material => {

			if ( ! material.isNodeMaterial ) {

				return;

			}

			const materialOutputs = outputs
				.filter( ( { property } ) => material[ property ] )
				.map( ( { property, field, type } ) => ( { field, type, node: material[ property ] } ) );

			// TODO: share graphs that build to the same WGSL. Matching nodes isn't enough since graphs can read the material
			if ( materialOutputs.length > 0 ) {

				this.graphIndices.set( material, graphs.length );
				graphs.push( { material, outputs: materialOutputs } );

			}

		} );

		const changed = this.evaluateFn === null || ! areGraphsEqual( graphs, this.graphs );
		this.graphs = graphs;
		if ( changed ) {

			this.evaluateFn = getEvaluateMaterialGraphFn( graphs );

		}

		return changed;

	}

	/**
	 * Returns the material's "graphIndex", or -1 without graphs.
	 *
	 * @param {Material} material
	 * @returns {number}
	 */
	getGraphIndex( material ) {

		return this.graphIndices.get( material ) ?? - 1;

	}

}

function areGraphsEqual( a, b ) {

	return a.length === b.length && a.every( ( { material, outputs }, i ) => {

		const other = b[ i ].outputs;
		return material === b[ i ].material && outputs.length === other.length && outputs.every( ( output, j ) => output.node === other[ j ].node && output.field === other[ j ].field && output.type === other[ j ].type );

	} );

}
