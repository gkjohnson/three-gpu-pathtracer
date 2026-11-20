/** @import { WebGPURenderer } from 'three/webgpu' */
import { BufferAttribute, DoubleSide, FloatType, InstancedBufferGeometry, Mesh, NearestFilter, NodeMaterial, OrthographicCamera, RendererUtils, RenderTarget, Scene } from 'three/webgpu';
import { float, instanceIndex, uniform, vec4, vertexIndex } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

let _rendererState;

/**
 * Rasterizes triangles of the path tracer's scene in their "uv1" space on the GPU so every texel records
 * the triangle covering its center. The red channel holds the triangle index plus one, so zero marks an
 * empty texel, the green channel the transform slot of the triangle's group, and alpha is one where a
 * triangle covers the texel. Texel row 0 is v = 0.
 */
export class UVTriangleIdTexture {

	constructor() {

		// TODO: the blue and alpha channels could be removed, leaving an RG texture, if the seam stitcher
		// read coverage from "red > 0" rather than alpha
		this.renderTarget = new RenderTarget( 1, 1, {
			type: FloatType,
			depthBuffer: false,
			generateMipmaps: false,
			minFilter: NearestFilter,
			magFilter: NearestFilter,
		} );
		this.texture = this.renderTarget.texture;

		this._scene = new Scene();
		this._camera = new OrthographicCamera();

	}

	setSize( width, height ) {

		this.renderTarget.setSize( width, height );

	}

	/**
	 * Rasterizes the given triangle ranges of the tracer's packed index, each from its first triangle with
	 * the transform slot it belongs to. Call it again after the scene is rebuilt.
	 *
	 * @param {WebGPURenderer} renderer
	 * @param {Object} storage - The tracer's scene buffers, with its "index" and "attributes".
	 * @param {Array<{ triangleOffset: number, count: number, slot: number }>} ranges
	 */
	update( renderer, storage, ranges ) {

		this._clearScene();

		// each range draws one instance per triangle with no vertex data, reading the corners of its
		// triangle from the tracer's buffers, so nothing is copied
		const position = new BufferAttribute( new Float32Array( 9 ), 3 );
		for ( const { triangleOffset, count, slot } of ranges ) {

			const offset = uniform( triangleOffset, 'uint' );
			const uvPosition = wgslTagFn/* wgsl */`
				fn uvPosition( instance: u32, corner: u32 ) -> vec4f {

					let i = ${ storage.index }[ ( ${ offset } + instance ) * 3u + corner ];
					let uv = ${ storage.attributes }[ i ].uv1.xy;
					return vec4f( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0 );

				}
			`;

			// either winding counts as covered
			const material = new NodeMaterial();
			material.side = DoubleSide;
			material.depthTest = false;
			material.depthWrite = false;
			material.vertexNode = uvPosition( instanceIndex, vertexIndex );
			material.fragmentNode = vec4( float( offset.add( instanceIndex ).add( 1 ) ), float( slot ), 0, 1 );

			const geometry = new InstancedBufferGeometry();
			geometry.setAttribute( 'position', position );
			geometry.instanceCount = count;

			const mesh = new Mesh( geometry, material );
			mesh.frustumCulled = false;
			this._scene.add( mesh );

		}

		_rendererState = RendererUtils.resetRendererState( renderer, _rendererState );
		renderer.setClearColor( 0, 0 );
		renderer.setRenderTarget( this.renderTarget );
		renderer.clear();
		renderer.render( this._scene, this._camera );
		RendererUtils.restoreRendererState( renderer, _rendererState );

	}

	dispose() {

		this._clearScene();
		this.renderTarget.dispose();

	}

	_clearScene() {

		for ( const mesh of this._scene.children ) {

			mesh.geometry.dispose();
			mesh.material.dispose();

		}

		this._scene.clear();

	}

}
