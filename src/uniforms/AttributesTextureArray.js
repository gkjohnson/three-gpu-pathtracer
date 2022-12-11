import { FloatAttributeTextureArray } from './FloatAttributeTextureArray.js';

export class AttributesTextureArray extends FloatAttributeTextureArray {

	updateNormalAttribute( attr ) {

		this.updateAttribute( 0, attr );

	}

	updateTangentAttribute( attr ) {

		this.updateAttribute( 1, attr );

	}

	updateUvAttribute( attr ) {

		this.updateAttribute( 2, attr );

	}

	updateColorAttribute( attr ) {

		this.updateAttribute( 3, attr );

	}

	updateFrom( normal, tangent, uv, color ) {

		this.setAttributes( [ normal, tangent, uv, color ] );

	}

}
