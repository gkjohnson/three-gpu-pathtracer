import { Color, Vector3 } from 'three';
import { ProceduralEquirectTexture } from './ProceduralEquirectTexture.js';

const _direction = new Vector3();
export class GradientEquirectTexture extends ProceduralEquirectTexture {

	constructor( topColor = 0xffffff, bottomColor = 0, resolution = 512 ) {

		super( resolution, resolution );

		this.topColor = new Color().set( topColor );
		this.bottomColor = new Color().set( bottomColor );
		this.generationCallback = ( polar, uv, coord, color ) => {

			_direction.setFromSpherical( polar );

			const t = _direction.y * 0.5 + 0.5;
			color.lerpColors( this.bottomColor, this.topColor, t );

		};

	}

	copy( other ) {

		super.copy( other );

		this.topColor.copy( other.topColor );
		this.bottomColor.copy( other.bottomColor );

	}

}
