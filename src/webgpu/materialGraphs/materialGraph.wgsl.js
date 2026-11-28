/** @import { Camera, Material, StorageBufferNode, UniformNode } from 'three/webgpu' */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Node, PerspectiveCamera, StructTypeNode, Vector3, VaryingNode } from 'three/webgpu';
import {
	Fn, context, expression, overrideNodes, float, int, mat3, uniform, vec2, vec3, vec4, frontFacing, positionViewDirection, normalFlat,
	modelWorldMatrix, modelWorldMatrixInverse, modelNormalMatrix, modelPosition, modelScale, modelDirection, modelViewPosition,
	cameraViewMatrix, cameraWorldMatrix, cameraNormalMatrix, cameraPosition, cameraProjectionMatrix,
	cameraProjectionMatrixInverse, cameraNear, cameraFar,
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
// uniforms of "createCameraUniforms"
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

/**
 * Returns the uniforms for three.js' camera nodes the graphs read, by node. Set them with "updateCameraUniforms".
 *
 * @returns {Map<Node,UniformNode>}
 */
export function createCameraUniforms() {

	return new Map( [
		[ cameraViewMatrix, uniform( new Matrix4() ) ],
		[ cameraWorldMatrix, uniform( new Matrix4() ) ],
		[ cameraNormalMatrix, uniform( new Matrix3() ) ],
		[ cameraPosition, uniform( new Vector3() ) ],
		[ cameraProjectionMatrix, uniform( new Matrix4() ) ],
		[ cameraProjectionMatrixInverse, uniform( new Matrix4() ) ],
		[ cameraNear, uniform( 0 ) ],
		[ cameraFar, uniform( 0 ) ],
	] );

}

/**
 * Sets the uniforms from "createCameraUniforms" to the camera's values.
 *
 * @param {Map<Node,UniformNode>} cameraUniforms
 * @param {Camera} camera
 */
export function updateCameraUniforms( cameraUniforms, camera ) {

	cameraUniforms.get( cameraViewMatrix ).value.copy( camera.matrixWorldInverse );
	cameraUniforms.get( cameraWorldMatrix ).value.copy( camera.matrixWorld );
	cameraUniforms.get( cameraNormalMatrix ).value.getNormalMatrix( camera.matrixWorldInverse );
	cameraUniforms.get( cameraPosition ).value.setFromMatrixPosition( camera.matrixWorld );
	cameraUniforms.get( cameraProjectionMatrix ).value.copy( camera.projectionMatrix );
	cameraUniforms.get( cameraProjectionMatrixInverse ).value.copy( camera.projectionMatrixInverse );
	cameraUniforms.get( cameraNear ).value = camera.near ?? 0;
	cameraUniforms.get( cameraFar ).value = camera.far ?? 0;

}

// The surface inputs a graph can set: the node material's property, the field of the result it writes and its type
export const GRAPH_OUTPUTS = [
	{ key: 'colorNode', name: 'color', type: 'vec3' },
	{ key: 'opacityNode', name: 'opacity', type: 'float' },
	{ key: 'roughnessNode', name: 'roughness', type: 'float' },
	{ key: 'metalnessNode', name: 'metalness', type: 'float' },
	{ key: 'emissiveNode', name: 'emission', type: 'vec3' },
];

export const materialGraphInputStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_INPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphInput',
);

export const materialGraphResultStruct = new StructTypeNode(
	Object.fromEntries( GRAPH_OUTPUTS.map( ( { name, type } ) => [ name, type ] ) ),
	'MaterialGraphResult',
);

/**
 * Returns the WGSL function running the graphs of one material, writing the outputs it has graphs for to "result":
 * `fn runMaterialGraph( graph: i32, input: MaterialGraphInput, result: ptr<function, MaterialGraphResult> )`
 *
 * "graphs" holds each "material", its "outputs", each a "GRAPH_OUTPUTS" entry with its graph's "node", and
 * "textures", the descriptor each texture node is sampled with from the atlas by "sampleTexel". Graph "i" is the
 * material at index "i". Each graph is built into its own function by three.js, reading the camera from the uniforms
 * of "createCameraUniforms".
 *
 * @param {Array<{material:Material,outputs:Array<Object>,textures:Map<Node,number>}>} graphs
 * @param {Map<Node,UniformNode>} cameraUniforms
 * @param {Function} sampleTexel
 * @returns {Function}
 */
export function getRunMaterialGraphFn( graphs, cameraUniforms, sampleTexel ) {

	const parts = [
		'fn runMaterialGraph( graph: i32, input: ', materialGraphInputStruct,
		', result: ptr<function, ', materialGraphResultStruct, '> ) -> void {\n\nswitch ( graph ) {\n\n',
	];

	graphs.forEach( ( { material, outputs, textures }, graph ) => {

		parts.push( `case ${ graph }: {\n\n` );
		outputs.forEach( ( { name, type, node } ) => {

			const call = buildGraphCall( material, node, type, { textures, cameraUniforms, sampleTexel }, `materialGraph${ graph }_${ name }` );
			parts.push( `result.${ name } = `, call, ';\n' );

		} );
		parts.push( '\n}\n\n' );

	} );

	parts.push( 'default: {}\n\n}\n\n}\n' );
	return joinTagFn( parts );

}

/**
 * Returns the WGSL function a surface record calls to apply the TSL graphs of the hit's material, which run with
 * "runFn" from "getRunMaterialGraphFn" and are found by the material's index in "graphIndices":
 * `fn applyMaterialGraph( hit, vertexData, normal: vec3f, shadingNormal: vec3f, view: vec3f, result: ptr<function, MaterialGraphResult> )`
 *
 * "result" holds the surface inputs from the material, which the graphs replace. "normal" is the interpolated normal
 * and "shadingNormal" the normal on the side hit after the material's normal maps.
 *
 * @param {Function} runFn
 * @param {StorageBufferNode} graphIndices
 * @returns {Function}
 */
export function getApplyMaterialGraphFn( runFn, graphIndices ) {

	return wgslTagFn/* wgsl */`
		fn applyMaterialGraph(
			hit: ${ hitRecordStruct },
			vertexData: ${ attributesStruct },
			normal: vec3f,
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
			input.normal = normalize( ( transpose( objectInfo.matrixWorld ) * vec4f( normal, 0.0 ) ).xyz );
			input.tangent = vec4f( ( objectInfo.inverseMatrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w );
			input.uv = ${ getUvFromChannel }( vertexData, 0 );
			input.uv1 = ${ getUvFromChannel }( vertexData, 1 << 23 );
			input.color = ${ getColor }( vertexData );

			${ runFn }( graph, input, result );

		}
	`;

}

/**
 * The "applyMaterialGraph" function of a shading model without material graphs, which leaves the surface inputs as
 * they are.
 */
export const noMaterialGraphFn = /* @__PURE__ */ wgslTagFn/* wgsl */`
	fn applyMaterialGraph(
		hit: ${ hitRecordStruct },
		vertexData: ${ attributesStruct },
		normal: vec3f,
		shadingNormal: vec3f,
		view: vec3f,
		result: ptr<function, ${ materialGraphResultStruct }>,
	) -> void {}
`;

// Returns a call of a TSL function evaluating "node", a graph of "material", as "type" from the "input" struct. three.js
// builds it as when rasterizing the material, with the hit's values in place of the vertex stage, object and camera,
// and the texture nodes in "textures" sampled from the atlas with their descriptors
function buildGraphCall( material, node, type, { textures, cameraUniforms, sampleTexel }, name ) {

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

		textures.forEach( ( descriptor, textureNode ) => {

			overrides.push( [ textureNode, sampleTexel( getTextureUV( textureNode ), int( descriptor ), float( 0 ) ) ] );

		} );

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

// the uv a texture node samples at, with its texture's transform, as three.js' TextureNode sets it up
function getTextureUV( textureNode ) {

	const uvNode = textureNode.uvNode ?? textureNode.getDefaultUV();
	return textureNode.updateMatrix ? textureNode.getTransformedUV( uvNode ) : vec2( uvNode );

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
