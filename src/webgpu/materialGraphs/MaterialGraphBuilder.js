import { BufferAttribute, BufferGeometry, Node, PerspectiveCamera, WGSLNodeBuilder } from 'three/webgpu';
import {
	overrideNodes, expression, float, mat3, vec3, vec4, frontFacing, positionViewDirection, normalFlat,
	modelWorldMatrix, modelWorldMatrixInverse, modelNormalMatrix, modelPosition, modelScale, modelDirection, modelViewPosition,
	cameraViewMatrix, cameraWorldMatrix, cameraNormalMatrix, cameraPosition, cameraProjectionMatrix,
	cameraProjectionMatrixInverse, cameraNear, cameraFar,
} from 'three/tsl';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { getBasisFromNormalFunc } from '../nodes/utils.wgsl.js';
import { hitRecordStruct } from '../nodes/structs.wgsl.js';

const attributesStruct = /* @__PURE__ */ contextProxy( 'bvhData.structs.attributes' );
const objectRecordStruct = /* @__PURE__ */ contextProxy( 'bvhData.structs.objectRecord' );
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
const graphGeometry = /* @__PURE__ */ new BufferGeometry();
Object.entries( { position: 3, normal: 3, tangent: 4, uv: 2, uv1: 2, color: 4 } ).forEach( ( [ name, itemSize ] ) => {

	graphGeometry.setAttribute( name, new BufferAttribute( new Float32Array( itemSize ), itemSize ) );

} );

const graphCamera = /* @__PURE__ */ new PerspectiveCamera();

// Returns the WGSL function evaluating "node", one graph of "material", as "type"
export function getMaterialGraphFn( name, material, node, type ) {

	return wgslTagFn/* wgsl */`
		fn ${ name }(
			hit: ${ hitRecordStruct },
			vertexData: ${ attributesStruct },
			objectInfo: ${ objectRecordStruct },
			view: vec3f,
			shadingNormal: vec3f,
		) -> ${ builder => builder.getType( type ) } {

			${ new MaterialGraphBodyNode( material, node, type ) }

		}
	`;

}

// The body of a graph's function, built with "MaterialGraphBuilder" when the kernel builds
class MaterialGraphBodyNode extends Node {

	constructor( material, node, type ) {

		super();
		this.material = material;
		this.graphType = type;

		// private so the kernel doesn't build it as a child node
		this._graphNode = node;

	}

	build( builder ) {

		return new MaterialGraphBuilder( builder, this.material ).buildGraph( this._graphNode, this.graphType );

	}

}

// Builds a material graph as three.js builds a fragment shader. Bindings and helper functions are declared in the
// kernel's builder
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

	// returns the body of a function returning "node", reading the parameters of "getMaterialGraphFn"
	buildGraph( node, type ) {

		const { kernelBuilder, material } = this;
		const { camera, bvhData } = kernelBuilder.getContext();
		const { fns } = bvhData;

		// the hit's values, read from the parameters when a graph uses them
		const vertexData = expression( 'vertexData', bvhData.structs.attributes.name );
		const matrixWorld = expression( 'objectInfo.matrixWorld', 'mat4' );
		const matrixWorldInverse = expression( 'objectInfo.inverseMatrixWorld', 'mat4' );
		const normal = expression( 'normalize( ( transpose( objectInfo.matrixWorld ) * vec4f( vertexData.normal.xyz, 0.0 ) ).xyz )', 'vec3' ).toVar();
		const tangent = expression( 'vec4f( ( objectInfo.inverseMatrixWorld * vec4f( vertexData.tangent.xyz, 0.0 ) ).xyz, vertexData.tangent.w )', 'vec4' );
		const attributes = {
			position: expression( '( objectInfo.inverseMatrixWorld * vec4f( vertexData.position.xyz, 1.0 ) ).xyz', 'vec3' ).toVar(),
			normal,
			tangent: getGraphTangent( tangent, normal, expression( 'hit.indices', 'uvec3' ), expression( 'objectInfo.attributesOffset', 'uint' ) ).toVar(),
			uv: fns.getUvFromChannel( vertexData, 0 ),
			uv1: fns.getUvFromChannel( vertexData, 1 << 23 ),
			color: fns.getColor( vertexData ),
		};

		// replace the object, camera and rasterizer values with the hit's
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
			[ frontFacing, expression( 'hit.side == 1.0', 'bool' ) ],
			[ normalFlat, expression( 'hit.normal', 'vec3' ).transformDirection( viewMatrix ) ],

			// the ray direction, which is only toward the camera for camera rays
			[ positionViewDirection, expression( 'view', 'vec3' ).transformDirection( viewMatrix ) ],
		];

		this.context = {
			...kernelBuilder.getContext(),
			getAttribute: name => attributes[ name ] ?? null,
			setupNormal: () => expression( 'shadingNormal', 'vec3' ).transformDirection( viewMatrix ),
			setupPositionView: () => material.setupPositionView( this ),
			inlineVaryings: true,
		};

		const value = overrideNodes( overrides, type === 'float' ? float( node ) : vec3( node ) );
		const flow = this.flowStagesNode( value, type );

		// the kernel updates per frame nodes
		this.nodes.forEach( node => kernelBuilder.addNode( node ) );
		this.sequentialNodes.forEach( node => kernelBuilder.addSequentialNode( node ) );

		return `${ flow.vars }\n${ flow.code }\n\treturn ${ flow.result };`;

	}

}
