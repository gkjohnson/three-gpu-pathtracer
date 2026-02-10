import { NodeMaterial, StorageBufferAttribute, Vector2 } from 'three/webgpu';
import { wgslFn, varying, storage, uniform, uv, positionGeometry } from 'three/tsl';

export class BlitBufferNodeMaterial extends NodeMaterial {

	get dimensions() {

		return this.fragmentNode.parameters.dimensions.value;

	}

	get resultBuffer() {

		return this.fragmentNode.parameters.resultBuffer.value;

	}

	set resultBuffer( value ) {

		if ( value === this.resultBuffer ) {

			return;

		}

		const fragmentShaderParams = {
			resultBuffer: storage( value, 'vec4' ),
			dimensions: uniform( this.dimensions ),
			uv: varying( uv() ),
		};

		this.fragmentNode = this.blitFragmentShader( fragmentShaderParams );

	}

	constructor( ) {

		super();

		const fragmentShaderParams = {
			resultBuffer: storage( new StorageBufferAttribute(), 'vec4' ),
			dimensions: uniform( new Vector2() ),
			uv: varying( uv() ),
		};

		// TODO: Apply gamma correction?
		this.blitFragmentShader = wgslFn( /* wgsl */ `
			fn blit(
				resultBuffer: ptr<storage, array<vec4f>, read>,
				dimensions: vec2u,
				uv: vec2f,
			) -> vec4f {
				let x = min(u32( uv.x * f32(dimensions.x) ), dimensions.x - 1);
				let y = min(u32( uv.y * f32(dimensions.y) ), dimensions.y - 1);
				let offset = x + y * dimensions.x;
				return resultBuffer[offset];
			}
		` );

		this.fragmentNode = this.blitFragmentShader( fragmentShaderParams );

		const vertexShaderParams = {
			position: positionGeometry,
		};

		const fullScreenQuadVertex = wgslFn( /* wgsl */ `
			fn noop(position: vec4f) -> vec4f {
				return position;
			}
		` );

		this.vertexNode = fullScreenQuadVertex( vertexShaderParams );

	}

}
