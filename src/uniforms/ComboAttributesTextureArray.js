import { FloatAttributeTextureArray } from './FloatAttributeTextureArray.js';

export class ComboAttributesTextureArray extends FloatAttributeTextureArray {

	setNormalAttribute( attr ) {

		this.updateAttribute( 0, attr );

	}

	setTangentAttribute( attr ) {

		this.updateAttribute( 1, attr );

	}

	setUvAttribute( attr ) {

		this.updateAttribute( 2, attr );

	}

	setColorAttribute( attr ) {

		this.updateAttribute( 3, attr );

	}

	updateFrom( normal, tangent, uv, color ) {

		this.setAttributes( [ normal, tangent, uv, color ] );

	}

}
