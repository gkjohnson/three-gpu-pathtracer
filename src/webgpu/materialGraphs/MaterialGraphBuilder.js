import { BufferAttribute, BufferGeometry, CodeNode, PerspectiveCamera, WGSLNodeBuilder } from 'three/webgpu';
import {
	overrideNodes, nodeObject, parameter, float, mat3, vec3, vec4, frontFacing, positionViewDirection, normalFlat,
	modelWorldMatrix, modelWorldMatrixInverse, modelNormalMatrix, modelPosition, modelScale, modelDirection, modelViewPosition,
	cameraViewMatrix, cameraWorldMatrix, cameraNormalMatrix, cameraPosition, cameraProjectionMatrix,
	cameraProjectionMatrixInverse, cameraNear, cameraFar,
} from 'three/tsl';
import { wgslTagFn, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { getBasisFromNormalFunc } from '../nodes/utils.wgsl.js';

// the geometry attributes at the hit, in local space
const GRAPH_ATTRIBUTES = [
	{ name: 'position', type: 'vec3' },
	{ name: 'normal', type: 'vec3' },
	{ name: 'tangent', type: 'vec4' },
	{ name: 'uv', type: 'vec2' },
	{ name: 'uv1', type: 'vec2' },
	{ name: 'color', type: 'vec4' },
];

// the hit values three.js otherwise reads from the object and rasterizer, in world space
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

// the graph function parameters, which three.js derives every other value from
export const GRAPH_INPUTS = [ ...GRAPH_ATTRIBUTES, ...GRAPH_HIT_VALUES ];

const getVertex = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getVertex' );
const getUvFromChannel = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getUvFromChannel' );

// the vertex tangent, or one derived from the triangle's uvs when missing
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

// stand-in geometry and camera, which three.js reads while building
const ITEM_SIZES = { vec2: 2, vec3: 3, vec4: 4 };
const graphGeometry = /* @__PURE__ */ new BufferGeometry();
GRAPH_ATTRIBUTES.forEach( ( { name, type } ) => {

	const itemSize = ITEM_SIZES[ type ];
	graphGeometry.setAttribute( name, new BufferAttribute( new Float32Array( itemSize ), itemSize ) );

} );

const graphCamera = /* @__PURE__ */ new PerspectiveCamera();

// Builds a material graph into a WGSL function, as three.js builds a fragment shader. Bindings and helper functions are
// declared in the kernel's builder
class MaterialGraphBuilder extends WGSLNodeBuilder {

	constructor( kernelBuilder, material ) {

		super( kernelBuilder.object, kernelBuilder.renderer );
		this.kernelBuilder = kernelBuilder;
		this.material = material;
		this.geometry = graphGeometry;
		this.camera = graphCamera;

		// built as a fragment shader so "inlineVaryings" applies
		this.setShaderStage( 'fragment' );

	}

	getUniformFromNode( node, type, shaderStage, name = null ) {

		const { kernelBuilder } = this;
		return kernelBuilder.getUniformFromNode( node, type, kernelBuilder.shaderStage, name );

	}

	getCodeFromNode( node, type ) {

		const { kernelBuilder } = this;
		return kernelBuilder.getCodeFromNode( node, type, kernelBuilder.shaderStage );

	}

	getStructTypeFromNode( node, membersLayout, name = null ) {

		const { kernelBuilder } = this;
		return kernelBuilder.getStructTypeFromNode( node, membersLayout, name, kernelBuilder.shaderStage );

	}

	// compute has no derivatives, so sample textures as compute does
	generateTexture( texture, textureProperty, uvSnippet, depthSnippet, offsetSnippet ) {

		return super.generateTexture( texture, textureProperty, uvSnippet, depthSnippet, offsetSnippet, 'compute' );

	}

	generateTextureBias( texture, textureProperty, uvSnippet, biasSnippet, depthSnippet, offsetSnippet ) {

		return super.generateTextureBias( texture, textureProperty, uvSnippet, biasSnippet, depthSnippet, offsetSnippet, 'compute' );

	}

	generateTextureCompare( texture, textureProperty, uvSnippet, compareSnippet, depthSnippet, offsetSnippet ) {

		return super.generateTextureCompare( texture, textureProperty, uvSnippet, compareSnippet, depthSnippet, offsetSnippet, 'compute' );

	}

	// returns the WGSL function "name" returning "node", with "GRAPH_INPUTS" as parameters
	buildGraphFunction( name, node, type ) {

		const { kernelBuilder, material } = this;
		const inputs = {};
		GRAPH_INPUTS.forEach( input => inputs[ input.name ] = nodeObject( parameter( input.type, input.name ) ) );

		// replace the object, camera and rasterizer values with the hit's
		const { camera } = kernelBuilder.getContext();
		const { matrixWorld, matrixWorldInverse } = inputs;
		const { viewMatrix } = camera;
		const objectPosition = matrixWorld.element( 3 ).xyz;
		const overrides = [
			[ cameraViewMatrix, viewMatrix ],
			[ cameraWorldMatrix, camera.worldMatrix ],
			[ cameraNormalMatrix, camera.normalMatrix ],
			[ cameraPosition, camera.position ],
			[ cameraProjectionMatrix, camera.projectionMatrix ],
			[ cameraProjectionMatrixInverse, camera.projectionMatrixInverse ],
			[ cameraNear, camera.near ],
			[ cameraFar, camera.far ],
			[ modelWorldMatrix, matrixWorld ],
			[ modelWorldMatrixInverse, matrixWorldInverse ],
			[ modelNormalMatrix, mat3( matrixWorldInverse ).transpose() ],
			[ modelPosition, objectPosition ],
			[ modelScale, vec3( matrixWorld.element( 0 ).xyz.length(), matrixWorld.element( 1 ).xyz.length(), matrixWorld.element( 2 ).xyz.length() ) ],
			[ modelDirection, matrixWorld.element( 2 ).xyz.normalize() ],
			[ modelViewPosition, viewMatrix.mul( vec4( objectPosition, 1 ) ).xyz ],
			[ frontFacing, inputs.frontFacing ],
			[ normalFlat, inputs.faceNormal.transformDirection( viewMatrix ) ],

			// the ray direction, which is only toward the camera for camera rays
			[ positionViewDirection, inputs.viewDirection.transformDirection( viewMatrix ) ],
		];

		const attributes = Object.fromEntries( GRAPH_ATTRIBUTES.map( ( { name } ) => [ name, inputs[ name ] ] ) );
		attributes.tangent = getGraphTangent( inputs.tangent, inputs.normal, inputs.indices, inputs.attributesOffset );

		this.context = {
			...kernelBuilder.getContext(),
			getAttribute: name => attributes[ name ] ?? null,
			setupNormal: () => inputs.shadingNormal.transformDirection( viewMatrix ),
			setupPositionView: () => material.setupPositionView( this ),
			inlineVaryings: true,
		};

		const value = overrideNodes( overrides, type === 'float' ? float( node ) : vec3( node ) );
		const flow = this.flowStagesNode( value, type );

		// the kernel updates per frame nodes
		this.nodes.forEach( node => kernelBuilder.addNode( node ) );
		this.sequentialNodes.forEach( node => kernelBuilder.addSequentialNode( node ) );

		const parameters = GRAPH_INPUTS.map( input => `${ input.name }: ${ this.getType( input.type ) }` );
		return `fn ${ name }( ${ parameters.join( ', ' ) } ) -> ${ this.getType( type ) } {\n${ flow.vars }\n${ flow.code }\n\treturn ${ flow.result };\n\n}\n`;

	}

}

// A graph's WGSL function, built with "MaterialGraphBuilder" when the kernel builds
export class MaterialGraphFunctionNode extends CodeNode {

	constructor( name, material, graphNode, type ) {

		super();
		this.functionName = name;
		this.material = material;
		this.graphType = type;

		// private so the kernel doesn't build it as a child node
		this._graphNode = graphNode;

	}

	generate( builder ) {

		const nodeCode = builder.getCodeFromNode( this, this.getNodeType( builder ) );
		if ( nodeCode.code === '' ) {

			const graphBuilder = new MaterialGraphBuilder( builder, this.material );
			nodeCode.code = graphBuilder.buildGraphFunction( this.functionName, this._graphNode, this.graphType );

		}

		return this.functionName;

	}

}
