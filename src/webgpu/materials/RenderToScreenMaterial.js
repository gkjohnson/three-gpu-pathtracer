import { MeshBasicNodeMaterial, StorageTexture } from 'three/webgpu';
import { uv, varying, texture } from 'three/tsl';

export class RenderToScreenNodeMaterial extends MeshBasicNodeMaterial {

	get texture() {

		return this.colorNode.value;

	}

	set texture( v ) {

		this.colorNode.value = v;

	}

	constructor( params ) {

		super();
		this.transparent = true;
		this.colorNode = texture( new StorageTexture(), varying( uv() ) );
		this.setValues( params );

	}

}
