import { StorageBufferAttribute, Vector2, MeshBasicNodeMaterial, StorageTexture } from 'three/webgpu';
import { storage, uniform, uv, varying, texture } from 'three/tsl';

export class RenderToScreenNodeMaterial extends MeshBasicNodeMaterial {

	get dimensions() {

		return this._dimensionsUniform.value;

	}

	get resultBuffer() {

		return this._resultBufferUniform.value;

	}

	set resultBuffer( v ) {

		this._resultBufferUniform.value = v;

	}

	get texture() {

		return this._texture.value;

	}

	set texture( v ) {

		this._texture.value = v;

	}

	constructor( params ) {

		super();

		const fragmentShaderParams = {
			resultBuffer: this._resultBufferUniform,
			dimensions: this._dimensionsUniform,
			uv: varying( uv() ),
		};

		this._resultBufferUniform = storage( new StorageBufferAttribute(), 'vec4' );
		this._dimensionsUniform = uniform( new Vector2() );
		this._texture = texture( new StorageTexture(), fragmentShaderParams.uv );

		// TODO: Apply gamma correction
		// this.colorNode = colorSpaceToWorking( this._texture, SRGBColorSpace );
		this.colorNode = this._texture;

		this.setValues( params );

	}

}
