import { Color, Vector3 } from 'three';
import { ProceduralEquirectTexture } from './ProceduralEquirectTexture.js';

const _direction = new Vector3();
export class GradientEquirectTexture extends ProceduralEquirectTexture {

	constructor( resolution = 512 ) {

		super( resolution, resolution );

		this.topColor = new Color().set( 0xffffff );
		this.bottomColor = new Color().set( 0x000000 );
		this.exponent = 2;
		this.generationCallback = ( polar, uv, coord, color ) => {

			_direction.setFromSpherical( polar );

			const t = _direction.y * 0.5 + 0.5;
			color.lerpColors( this.bottomColor, this.topColor, t ** this.exponent );

		};

	}

	copy( other ) {

		super.copy( other );

		this.topColor.copy( other.topColor );
		this.bottomColor.copy( other.bottomColor );
		return this;

	}

}
