import { BufferAttribute, BufferGeometry, Node, PerspectiveCamera, WGSLNodeBuilder } from 'three/webgpu';
import {
	overrideNodes, expression, convert, mat3, vec3, vec4, frontFacing, positionViewDirection, normalFlat,
	modelWorldMatrix, modelWorldMatrixInverse, modelNormalMatrix, modelPosition, modelScale, modelDirection, modelViewPosition,
	cameraViewMatrix, cameraWorldMatrix, cameraNormalMatrix, cameraPosition, cameraProjectionMatrix,
	cameraProjectionMatrixInverse, cameraNear, cameraFar,
} from 'three/tsl';
import { wgslTagFn, wgslTagCode, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { getBasisFromNormalFunc } from '../nodes/utils.wgsl.js';
import { hitRecordStruct } from '../nodes/structs.wgsl.js';

const attributesStruct = /* @__PURE__ */ contextProxy( 'bvhData.structs.attributes' );
const objectsStorage = /* @__PURE__ */ contextProxy( 'bvhData.storage.objects' );
const getVertex = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getVertex' );
const getUvFromChannel = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getUvFromChannel' );
const getColor = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getColor' );

// the hit being shaded, which the overrides below read so they work in any function a graph builds into
const graphGlobals = wgslTagCode/* wgsl */`
	var<private> graphHit: ${ hitRecordStruct };
	var<private> graphVertexData: ${ attributesStruct };
	var<private> graphMatrixWorld: mat4x4f;
	var<private> graphMatrixWorldInverse: mat4x4f;
	var<private> graphAttributesOffset: u32;
	var<private> graphView: vec3f;
	var<private> graphNormal: vec3f;
`;

// sets the hit the graphs read, with "normal" the shading normal
export const setMaterialGraphHitFn = wgslTagFn/* wgsl */`
	fn setMaterialGraphHit( hit: ${ hitRecordStruct }, vertexData: ${ attributesStruct }, view: vec3f, normal: vec3f ) -> void {

		${ [ graphGlobals ] }
		let objectInfo = &${ objectsStorage }[ hit.objectIndex ];
		graphHit = hit;
		graphVertexData = vertexData;
		graphMatrixWorld = objectInfo.matrixWorld;
		graphMatrixWorldInverse = objectInfo.inverseMatrixWorld;
		graphAttributesOffset = objectInfo.attributesOffset;
		graphView = view;
		graphNormal = normal;

	}
`;

// the hit's attributes in local space, computed when a graph reads them
const getGraphPosition = wgslTagFn/* wgsl */`
	fn getGraphPosition() -> vec3f {

		${ [ graphGlobals ] }
		return ( graphMatrixWorldInverse * vec4f( graphVertexData.position.xyz, 1.0 ) ).xyz;

	}
`;

const getGraphNormal = wgslTagFn/* wgsl */`
	fn getGraphNormal() -> vec3f {

		${ [ graphGlobals ] }
		return normalize( ( transpose( graphMatrixWorld ) * vec4f( graphVertexData.normal.xyz, 0.0 ) ).xyz );

	}
`;

const getGraphUv = wgslTagFn/* wgsl */`
	fn getGraphUv() -> vec2f {

		${ [ graphGlobals ] }
		return ${ getUvFromChannel }( graphVertexData, 0 );

	}
`;

const getGraphUv1 = wgslTagFn/* wgsl */`
	fn getGraphUv1() -> vec2f {

		${ [ graphGlobals ] }
		return ${ getUvFromChannel }( graphVertexData, 1 << 23 );

	}
`;

const getGraphColor = wgslTagFn/* wgsl */`
	fn getGraphColor() -> vec4f {

		${ [ graphGlobals ] }
		return ${ getColor }( graphVertexData );

	}
`;

// the vertex tangent, or one derived from the triangle's uvs when missing
const getGraphTangent = wgslTagFn/* wgsl */`
	fn getGraphTangent() -> vec4f {

		${ [ graphGlobals ] }
		let normal = ${ getGraphNormal }();
		let vertexTangent = vec4f( ( graphMatrixWorldInverse * vec4f( graphVertexData.tangent.xyz, 0.0 ) ).xyz, graphVertexData.tangent.w );
		if ( length( vertexTangent.xyz ) > 0.0 && vertexTangent.w != 0.0 ) {

			return vertexTangent;

		}

		let indices = graphHit.indices;
		let v0 = ${ getVertex }( indices.x, graphAttributesOffset );
		let v1 = ${ getVertex }( indices.y, graphAttributesOffset );
		let v2 = ${ getVertex }( indices.z, graphAttributesOffset );
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

// Returns the WGSL function evaluating "node", one graph of "material", as "type"
export function getMaterialGraphFn( name, material, node, type ) {

	return wgslTagFn/* wgsl */`
		fn ${ name }() -> ${ builder => builder.getType( type ) } {

			${ [ graphGlobals, getGraphPosition, getGraphNormal, getGraphTangent, getGraphUv, getGraphUv1, getGraphColor ] }
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

		// stand-ins three.js reads while building, with the attributes the hit provides
		this.camera = new PerspectiveCamera();
		this.geometry = new BufferGeometry();
		Object.entries( { position: 3, normal: 3, tangent: 4, uv: 2, uv1: 2, color: 4 } ).forEach( ( [ name, itemSize ] ) => {

			this.geometry.setAttribute( name, new BufferAttribute( new Float32Array( itemSize ), itemSize ) );

		} );

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

	// returns the body of a function returning "node", reading the hit from the globals
	buildGraph( node, type ) {

		const { kernelBuilder, material } = this;
		const { camera } = kernelBuilder.getContext();
		// typed expressions, since three reads their types before a function call node is set up
		const attributes = {
			position: expression( 'getGraphPosition()', 'vec3' ).toVar(),
			normal: expression( 'getGraphNormal()', 'vec3' ).toVar(),
			tangent: expression( 'getGraphTangent()', 'vec4' ).toVar(),
			uv: expression( 'getGraphUv()', 'vec2' ),
			uv1: expression( 'getGraphUv1()', 'vec2' ),
			color: expression( 'getGraphColor()', 'vec4' ),
		};

		// replace the object, camera and rasterizer values with the hit's
		const matrixWorld = expression( 'graphMatrixWorld', 'mat4' );
		const matrixWorldInverse = expression( 'graphMatrixWorldInverse', 'mat4' );
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
			[ frontFacing, expression( 'graphHit.side == 1.0', 'bool' ) ],
			[ normalFlat, expression( 'graphHit.normal', 'vec3' ).transformDirection( viewMatrix ) ],

			// the ray direction, which is only toward the camera for camera rays
			[ positionViewDirection, expression( 'graphView', 'vec3' ).transformDirection( viewMatrix ) ],
		];

		this.context = {
			...kernelBuilder.getContext(),
			getAttribute: name => attributes[ name ] ?? null,
			setupNormal: () => expression( 'graphNormal', 'vec3' ).transformDirection( viewMatrix ),
			setupPositionView: () => material.setupPositionView( this ),
			inlineVaryings: true,
		};

		const value = overrideNodes( overrides, convert( node, type ) );
		const flow = this.flowStagesNode( value, type );

		// the kernel updates per frame nodes
		this.nodes.forEach( node => kernelBuilder.addNode( node ) );
		this.sequentialNodes.forEach( node => kernelBuilder.addSequentialNode( node ) );

		return `${ flow.vars }\n${ flow.code }\n\treturn ${ flow.result };`;

	}

}
