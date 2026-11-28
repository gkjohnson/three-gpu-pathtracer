/** @import { Material, StorageBufferNode, UniformNode } from 'three/webgpu' */
import { BufferAttribute, BufferGeometry, Node, PerspectiveCamera, StructTypeNode, VaryingNode } from 'three/webgpu';
import {
	Fn, context, expression, overrideNodes, float, mat3, vec3, vec4, frontFacing, positionViewDirection, normalFlat,
	modelWorldMatrix, modelWorldMatrixInverse, modelNormalMatrix, modelPosition, modelScale, modelDirection, modelViewPosition,
	cameraViewMatrix,
} from 'three/tsl';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { getBasisFromNormalFunc } from '../nodes/utils.wgsl.js';
import { hitRecordStruct } from '../nodes/structs.wgsl.js';

// TODO: three.js only inlines varyings in the fragment stage with "inlineVaryings", so a graph reading a varying like
// "positionLocal" in a compute shader emits an undeclared variable. Remove this once three.js applies the fragment
// stage's rules in the compute stage too, as below
const _varyingSetup = VaryingNode.prototype.setup;
VaryingNode.prototype.setup = function ( builder ) {

	if ( builder.context.inlineVaryings === true && builder.shaderStage === 'compute' ) {

		let node = this.node;
		while ( node.isSubBuildNode === true ) {

			node = node.node;

		}

		if ( node.isIndexNode !== true && ( node.isAttributeNode !== true || node.getContextAttribute( builder ) ) ) {

			return this.node;

		}

	}

	return _varyingSetup.call( this, builder );

};

// TODO: three.js keeps a shader's variables and "once" function results in one cache shared by all of its functions,
// so a graph function declaring one, like "normalWorld", leaves the next graph function reading it undeclared. Each
// graph function keeps its own, as if it were its own shader, until three.js scopes them to the function being built.
// Code nodes stay shared so functions are declared once
const _isGlobal = Node.prototype.isGlobal;
Node.prototype.isGlobal = function ( builder ) {

	if ( builder.context.materialGraph === true && this.isCodeNode !== true ) {

		return false;

	}

	return _isGlobal.call( this, builder );

};

// The geometry attributes at the hit, in the object's space. "tangent" is the vertex tangent, which may be missing, and
// a graph reading the tangent attribute gets it from "getGraphTangent"
const GRAPH_ATTRIBUTES = [
	{ name: 'position', type: 'vec3' },
	{ name: 'normal', type: 'vec3' },
	{ name: 'tangent', type: 'vec4' },
	{ name: 'uv', type: 'vec2' },
	{ name: 'uv1', type: 'vec2' },
	{ name: 'color', type: 'vec4' },
];

// The values at the hit three.js otherwise reads from the object and the rasterizer, in world space: the object's
// matrices, the shading and face normals on the side hit, the direction the ray came from, whether it hit the front,
// and the triangle's vertices
const GRAPH_HIT_VALUES = [
	{ name: 'matrixWorld', type: 'mat4' },
	{ name: 'matrixWorldInverse', type: 'mat4' },
	{ name: 'shadingNormal', type: 'vec3' },
	{ name: 'faceNormal', type: 'vec3' },
	{ name: 'viewDirection', type: 'vec3' },
	{ name: 'frontFacing', type: 'bool' },
	{ name: 'indices', type: 'uvec3' },
	{ name: 'attributesOffset', type: 'uint' },
];

// The values a graph is built from. three.js derives every other value a graph reads from these, like the world
// position or the view space tangent
const GRAPH_INPUTS = [ ...GRAPH_ATTRIBUTES, ...GRAPH_HIT_VALUES ];

const attributesStruct = /* @__PURE__ */ contextProxy( 'bvhData.structs.attributes' );
const objectsStorage = /* @__PURE__ */ contextProxy( 'bvhData.storage.objects' );
const getVertex = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getVertex' );
const getUvFromChannel = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getUvFromChannel' );
const getColor = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getColor' );

// The tangent in the object's space and its bitangent's handedness: the vertex tangent, or else derived from the
// triangle's uvs, as three.js derives it from the screen space derivatives. Only graphs reading the tangent run it
const getGraphTangent = wgslTagFn/* wgsl */`
	fn getGraphTangent( vertexTangent: vec4f, normal: vec3f, indices: vec3u, attributesOffset: u32 ) -> vec4f {

		if ( length( vertexTangent.xyz ) > 0.0 && vertexTangent.w != 0.0 ) {

			return vertexTangent;

		}

		let v0 = ${ getVertex }( indices.x, attributesOffset );
		let v1 = ${ getVertex }( indices.y, attributesOffset );
		let v2 = ${ getVertex }( indices.z, attributesOffset );
		let edge1 = v1.position.xyz - v0.position.xyz;
		let edge2 = v2.position.xyz - v0.position.xyz;
		let uvEdge1 = ${ getUvFromChannel }( v1, 0 ) - ${ getUvFromChannel }( v0, 0 );
		let uvEdge2 = ${ getUvFromChannel }( v2, 0 ) - ${ getUvFromChannel }( v0, 0 );
		let uvDet = uvEdge1.x * uvEdge2.y - uvEdge2.x * uvEdge1.y;
		let du = ( edge1 * uvEdge2.y - edge2 * uvEdge1.y ) / select( 1.0, uvDet, uvDet != 0.0 );
		let dv = ( edge2 * uvEdge1.x - edge1 * uvEdge2.x ) / select( 1.0, uvDet, uvDet != 0.0 );
		let tangent = du - normal * dot( normal, du );
		if ( uvDet == 0.0 || length( tangent ) == 0.0 ) {

			return vec4f( ${ getBasisFromNormalFunc }( normal )[ 0 ], 1.0 );

		}

		return vec4f( normalize( tangent ), select( - 1.0, 1.0, dot( cross( normal, tangent ), dv ) >= 0.0 ) );

	}
`;

// The geometry the graphs are built with, so three.js' nodes find the attributes the hit provides
const ITEM_SIZES = { vec2: 2, vec3: 3, vec4: 4 };
const graphGeometry = /* @__PURE__ */ new BufferGeometry();
GRAPH_ATTRIBUTES.forEach( ( { name, type } ) => {

	const itemSize = ITEM_SIZES[ type ];
	graphGeometry.setAttribute( name, new BufferAttribute( new Float32Array( itemSize ), itemSize ) );

} );

// The camera the graphs are built with. three.js' camera nodes read it to find their types, and are replaced by the
// camera uniforms of "MaterialGraphs"
const graphCamera = /* @__PURE__ */ new PerspectiveCamera();

// Builds "node" with the builder's material, geometry and camera set, since three.js' nodes read them while building,
// as when rasterizing the material
class MaterialGraphBuildNode extends Node {

	constructor( node, material ) {

		super();
		this.node = node;
		this.material = material;

	}

	getNodeType( builder ) {

		return this.buildWithMaterial( builder, () => this.node.getNodeType( builder ) );

	}

	build( builder, output = null ) {

		return this.buildWithMaterial( builder, () => this.node.build( builder, output ) );

	}

	buildWithMaterial( builder, callback ) {

		const { material, geometry, camera } = builder;
		builder.material = this.material;
		builder.geometry = graphGeometry;
		builder.camera = graphCamera;

		const result = callback();
		builder.material = material;
		builder.geometry = geometry;
		builder.camera = camera;
		return result;

	}

}

// The surface inputs a graph can set: the node material's property, the field of the result it writes and its type
export const GRAPH_OUTPUTS = [
	{ key: 'colorNode', name: 'color', type: 'vec3' },
	{ key: 'opacityNode', name: 'opacity', type: 'float' },
	{ key: 'roughnessNode', name: 'roughness', type: 'float' },
	{ key: 'metalnessNode', name: 'metalness', type: 'float' },
	{ key: 'emissiveNode', name: 'emission', type: 'vec3' },
];

const materialGraphInputStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_INPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphInput',
);

export const materialGraphResultStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_OUTPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphResult',
);

/**
 * Returns the "evaluateMaterialGraph" WGSL function described in "MaterialGraphs", which fills the graph inputs from
 * the hit and runs the graphs of its material.
 *
 * "graphs" holds each "material" and its "outputs", each a "GRAPH_OUTPUTS" entry with its graph's "node".
 * "graphIndices" holds the index in "graphs" of each material, by its index in the shading model, or -1 without
 * graphs. "cameraUniforms" replace three.js' camera nodes, by node.
 *
 * @param {Array<{material:Material,outputs:Array<Object>}>} graphs
 * @param {StorageBufferNode} graphIndices
 * @param {Map<Node,UniformNode>} cameraUniforms
 * @returns {Function}
 */
export function getEvaluateMaterialGraphFn( graphs, graphIndices, cameraUniforms ) {

	const runFn = getRunMaterialGraphFn( graphs, cameraUniforms );
	return wgslTagFn/* wgsl */`
		fn evaluateMaterialGraph(
			hit: ${ hitRecordStruct },
			vertexData: ${ attributesStruct },
			shadingNormal: vec3f,
			view: vec3f,
			result: ptr<function, ${ materialGraphResultStruct }>,
		) -> void {

			let objectInfo = ${ objectsStorage }[ hit.objectIndex ];
			let graph = ${ graphIndices }[ objectInfo.materialIndex ];
			if ( graph == - 1 ) {

				return;

			}

			var input: ${ materialGraphInputStruct };
			input.matrixWorld = objectInfo.matrixWorld;
			input.matrixWorldInverse = objectInfo.inverseMatrixWorld;
			input.shadingNormal = shadingNormal;
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

			${ runFn }( graph, input, result );

		}
	`;

}

// Returns the function running graph "graph" of "graphs", a switch with a case per material calling the functions
// three.js builds for its outputs:
// `fn runMaterialGraph( graph: i32, input: MaterialGraphInput, result: ptr<function, MaterialGraphResult> )`
function getRunMaterialGraphFn( graphs, cameraUniforms ) {

	const parts = [
		'fn runMaterialGraph( graph: i32, input: ', materialGraphInputStruct,
		', result: ptr<function, ', materialGraphResultStruct, '> ) -> void {\n\nswitch ( graph ) {\n\n',
	];

	graphs.forEach( ( { material, outputs }, graph ) => {

		parts.push( `case ${ graph }: {\n\n` );
		outputs.forEach( ( { name, type, node } ) => {

			const call = buildGraphCall( material, node, type, cameraUniforms, `materialGraph${ graph }_${ name }` );
			parts.push( `result.${ name } = `, call, ';\n' );

		} );
		parts.push( '\n}\n\n' );

	} );

	parts.push( 'default: {}\n\n}\n\n}\n' );
	return joinTagFn( parts );

}

// Returns a call of a TSL function evaluating "node", a graph of "material", as "type" from the "input" struct. three.js
// builds it as when rasterizing the material, with the hit's values in place of the vertex stage, object and camera
function buildGraphCall( material, node, type, cameraUniforms, name ) {

	const fn = Fn( ( params, builder ) => {

		// the parameters are iterable but not indexable
		const values = [ ...params ];
		const inputs = {};
		GRAPH_INPUTS.forEach( ( input, i ) => inputs[ input.name ] = values[ i ] );

		// the values three.js sets per object drawn, and reads from the rasterizer
		const { matrixWorld } = inputs;
		const objectPosition = matrixWorld.element( 3 ).xyz;
		const viewMatrix = cameraUniforms.get( cameraViewMatrix );
		const overrides = [
			...cameraUniforms,
			[ modelWorldMatrix, matrixWorld ],
			[ modelWorldMatrixInverse, inputs.matrixWorldInverse ],
			[ modelNormalMatrix, mat3( inputs.matrixWorldInverse ).transpose() ],
			[ modelPosition, objectPosition ],
			[ modelScale, vec3( matrixWorld.element( 0 ).xyz.length(), matrixWorld.element( 1 ).xyz.length(), matrixWorld.element( 2 ).xyz.length() ) ],
			[ modelDirection, matrixWorld.element( 2 ).xyz.normalize() ],
			[ modelViewPosition, viewMatrix.mul( vec4( objectPosition, 1 ) ).xyz ],
			[ frontFacing, inputs.frontFacing ],
			[ normalFlat, inputs.faceNormal.transformDirection( viewMatrix ) ],

			// toward where the ray came from, which is the camera only for camera rays
			[ positionViewDirection, inputs.viewDirection.transformDirection( viewMatrix ) ],
		];

		const attributes = Object.fromEntries( GRAPH_ATTRIBUTES.map( ( { name } ) => [ name, inputs[ name ] ] ) );
		attributes.tangent = getGraphTangent( inputs.tangent, inputs.normal, inputs.indices, inputs.attributesOffset );

		const value = overrideNodes( overrides, type === 'float' ? float( node ) : vec3( node ) );
		return new MaterialGraphBuildNode( context( value, {
			getAttribute: name => attributes[ name ] ?? null,
			setupNormal: () => inputs.shadingNormal.transformDirection( viewMatrix ),
			setupPositionView: () => material.setupPositionView( builder ),
			inlineVaryings: true,
			materialGraph: true,
		} ), material );

	} ).setLayout( {
		name,
		type,
		inputs: GRAPH_INPUTS.map( ( { name, type } ) => ( { name, type } ) ),
	} );

	return fn( ...GRAPH_INPUTS.map( ( { name, type } ) => expression( `input.${ name }`, type ) ) );

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
