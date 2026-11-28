/** @import { Material, StorageBufferNode } from 'three/webgpu' */
import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { hitRecordStruct } from '../nodes/structs.wgsl.js';
import { GRAPH_INPUTS, MaterialGraphFunctionNode } from './MaterialGraphBuilder.js';

const attributesStruct = /* @__PURE__ */ contextProxy( 'bvhData.structs.attributes' );
const surfaceRecordStruct = /* @__PURE__ */ contextProxy( 'shadingModel.structs.surfaceRecord' );
const objectsStorage = /* @__PURE__ */ contextProxy( 'bvhData.storage.objects' );
const getUvFromChannel = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getUvFromChannel' );
const getColor = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getColor' );

const materialGraphInputStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_INPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphInput',
);

/**
 * Returns the "evaluateMaterialGraph" WGSL function described in "MaterialGraphs", which fills the graph inputs from
 * the hit and runs the graphs of its material.
 *
 * "graphs" holds each "material" and its "outputs", each the surface record "field" a graph sets, its "type" and the
 * graph's "node".
 * "graphIndices" holds the index in "graphs" of each material, by its index in the shading model, or -1 without
 * graphs.
 *
 * @param {Array<{material:Material,outputs:Array<Object>}>} graphs
 * @param {StorageBufferNode} graphIndices
 * @returns {Function}
 */
export function getEvaluateMaterialGraphFn( graphs, graphIndices ) {

	const runFn = getRunMaterialGraphFn( graphs );
	return wgslTagFn/* wgsl */`
		fn evaluateMaterialGraph(
			hit: ${ hitRecordStruct },
			vertexData: ${ attributesStruct },
			view: vec3f,
			surf: ptr<function, ${ surfaceRecordStruct }>,
		) -> void {

			let objectInfo = ${ objectsStorage }[ hit.objectIndex ];
			let graph = ${ graphIndices }[ objectInfo.materialIndex ];
			if ( graph == - 1 ) {

				return;

			}

			var input: ${ materialGraphInputStruct };
			input.matrixWorld = objectInfo.matrixWorld;
			input.matrixWorldInverse = objectInfo.inverseMatrixWorld;
			input.shadingNormal = surf.normal;
			input.faceNormal = hit.normal;
			input.viewDirection = view;
			input.frontFacing = hit.side == 1.0;
			input.indices = hit.indices;
			input.attributesOffset = objectInfo.attributesOffset;

			input.position = ( objectInfo.inverseMatrixWorld * vec4f( vertexData.position.xyz, 1.0 ) ).xyz;
			input.normal = normalize( ( transpose( objectInfo.matrixWorld ) * vec4f( vertexData.normal.xyz, 0.0 ) ).xyz );
			input.tangent = vec4f( ( objectInfo.inverseMatrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
			input.uv = ${ getUvFromChannel }( vertexData, 0 );
			input.uv1 = ${ getUvFromChannel }( vertexData, 1 << 23 );
			input.color = ${ getColor }( vertexData );

			${ runFn }( graph, input, surf );

		}
	`;

}

// Returns the function running graph "graph" of "graphs", a switch with a case per material calling the function of
// each of its outputs:
// `fn runMaterialGraph( graph: i32, input: MaterialGraphInput, surf: ptr<function, SurfaceRecord> )`
function getRunMaterialGraphFn( graphs ) {

	const args = GRAPH_INPUTS.map( ( { name } ) => `input.${ name }` ).join( ', ' );
	const parts = [
		'fn runMaterialGraph( graph: i32, input: ', materialGraphInputStruct,
		', surf: ptr<function, ', surfaceRecordStruct, '> ) -> void {\n\nswitch ( graph ) {\n\n',
	];

	graphs.forEach( ( { material, outputs }, graph ) => {

		parts.push( `case ${ graph }: {\n\n` );
		outputs.forEach( ( { field, type, node } ) => {

			const fn = new MaterialGraphFunctionNode( `materialGraph${ graph }_${ field }`, material, node, type );
			parts.push( `surf.${ field } = `, fn, `( ${ args } );\n` );

		} );
		parts.push( '\n}\n\n' );

	} );

	parts.push( 'default: {}\n\n}\n\n}\n' );
	return joinTagFn( parts );

}

// joins code strings and nodes into a "wgslTagFn", for code with a varying number of nodes
function joinTagFn( parts ) {

	const tokens = [ '' ];
	const args = [];
	for ( const part of parts ) {

		if ( typeof part === 'string' ) {

			tokens[ tokens.length - 1 ] += part;

		} else {

			args.push( part );
			tokens.push( '' );

		}

	}

	return wgslTagFn( tokens, ...args );

}
