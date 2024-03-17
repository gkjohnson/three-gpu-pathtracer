import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3, Vector4 } from 'three';

const _positionVector = /*@__PURE__*/ new Vector3();
const _normalVector = /*@__PURE__*/ new Vector3();
const _tangentVector = /*@__PURE__*/ new Vector3();
const _tangentVector4 = /*@__PURE__*/ new Vector4();

const _morphVector = /*@__PURE__*/ new Vector3();
const _temp = /*@__PURE__*/ new Vector3();

const _skinIndex = /*@__PURE__*/ new Vector4();
const _skinWeight = /*@__PURE__*/ new Vector4();
const _matrix = /*@__PURE__*/ new Matrix4();
const _boneMatrix = /*@__PURE__*/ new Matrix4();

// Confirms that the two provided attributes are compatible
function validateAttributes( attr1, attr2 ) {

	if ( ! attr1 && ! attr2 ) {

		return;

	}

	const sameCount = attr1.count === attr2.count;
	const sameNormalized = attr1.normalized === attr2.normalized;
	const sameType = attr1.array.constructor === attr2.array.constructor;
	const sameItemSize = attr1.itemSize === attr2.itemSize;

	if ( ! sameCount || ! sameNormalized || ! sameType || ! sameItemSize ) {

		throw new Error();

	}

}

// A version of "SkinnedMesh.boneTransform" for normals
function boneNormalTransform( mesh, index, target ) {

	const skeleton = mesh.skeleton;
	const geometry = mesh.geometry;
	const bones = skeleton.bones;
	const boneInverses = skeleton.boneInverses;

	_skinIndex.fromBufferAttribute( geometry.attributes.skinIndex, index );
	_skinWeight.fromBufferAttribute( geometry.attributes.skinWeight, index );

	_matrix.elements.fill( 0 );

	for ( let i = 0; i < 4; i ++ ) {

		const weight = _skinWeight.getComponent( i );

		if ( weight !== 0 ) {

			const boneIndex = _skinIndex.getComponent( i );
			_boneMatrix.multiplyMatrices( bones[ boneIndex ].matrixWorld, boneInverses[ boneIndex ] );

			addScaledMatrix( _matrix, _boneMatrix, weight );

		}

	}

	_matrix.multiply( mesh.bindMatrix ).premultiply( mesh.bindMatrixInverse );
	target.transformDirection( _matrix );

	return target;

}

// Applies the morph target data to the target vector
function applyMorphTarget( morphData, morphInfluences, morphTargetsRelative, i, target ) {

	_morphVector.set( 0, 0, 0 );
	for ( let j = 0, jl = morphData.length; j < jl; j ++ ) {

		const influence = morphInfluences[ j ];
		const morphAttribute = morphData[ j ];

		if ( influence === 0 ) continue;

		_temp.fromBufferAttribute( morphAttribute, i );

		if ( morphTargetsRelative ) {

			_morphVector.addScaledVector( _temp, influence );

		} else {

			_morphVector.addScaledVector( _temp.sub( target ), influence );

		}

	}

	target.add( _morphVector );

}

// Adds the "matrix" multiplied by "scale" to "target"
function addScaledMatrix( target, matrix, scale ) {

	const targetArray = target.elements;
	const matrixArray = matrix.elements;
	for ( let i = 0, l = matrixArray.length; i < l; i ++ ) {

		targetArray[ i ] += matrixArray[ i ] * scale;

	}

}

// inverts the geometry in place
function invertGeometry( geometry ) {

	const { index, attributes } = geometry;
	if ( index ) {

		for ( let i = 0, l = index.count; i < l; i += 3 ) {

			const v0 = index.getX( i );
			const v2 = index.getX( i + 2 );
			index.setX( i, v2 );
			index.setX( i + 2, v0 );

		}

	} else {

		for ( const key in attributes ) {

			const attr = attributes[ key ];
			const itemSize = attr.itemSize;
			for ( let i = 0, l = attr.count; i < l; i += 3 ) {

				for ( let j = 0; j < itemSize; j ++ ) {

					const v0 = attr.getComponent( i, j );
					const v2 = attr.getComponent( i + 2, j );
					attr.setComponent( i, j, v2 );
					attr.setComponent( i + 2, j, v0 );

				}

			}

		}

	}

	return geometry;

}

// target offset is the number of elements in the target buffer stride to skip before copying the
// attributes contents in to.
export function copyAttributeContents( attr, target, targetOffset = 0 ) {

	if ( attr.isInterleavedBufferAttribute ) {

		const itemSize = attr.itemSize;
		for ( let i = 0, l = attr.count; i < l; i ++ ) {

			const io = i + targetOffset;
			target.setX( io, attr.getX( i ) );
			if ( itemSize >= 2 ) target.setY( io, attr.getY( i ) );
			if ( itemSize >= 3 ) target.setZ( io, attr.getZ( i ) );
			if ( itemSize >= 4 ) target.setW( io, attr.getW( i ) );

		}

	} else {

		const array = target.array;
		const cons = array.constructor;
		const byteOffset = array.BYTES_PER_ELEMENT * attr.itemSize * targetOffset;
		const temp = new cons( array.buffer, byteOffset, attr.array.length );
		temp.set( attr.array );

	}

}

// Clones the given attribute with a new compatible buffer attribute but no data
export function createAttributeClone( attr, countOverride = null ) {

	const cons = attr.array.constructor;
	const normalized = attr.normalized;
	const itemSize = attr.itemSize;
	const count = countOverride === null ? attr.count : countOverride;

	return new BufferAttribute( new cons( itemSize * count ), itemSize, normalized );

}

export function convertToStaticGeometry( mesh, options = {}, targetGeometry = new BufferGeometry() ) {

	options = {
		applyWorldTransforms: true,
		attributes: [],
		...options
	};

	const geometry = mesh.geometry;
	const applyWorldTransforms = options.applyWorldTransforms;
	const includeNormal = options.attributes.includes( 'normal' );
	const includeTangent = options.attributes.includes( 'tangent' );
	const attributes = geometry.attributes;
	const targetAttributes = targetGeometry.attributes;

	// initialize the attributes if they don't exist
	if ( ! targetGeometry.index && geometry.index ) {

		targetGeometry.index = geometry.index.clone();

	}

	if ( ! targetAttributes.position ) {

		targetGeometry.setAttribute( 'position', createAttributeClone( attributes.position ) );

	}

	if ( includeNormal && ! targetAttributes.normal && attributes.normal ) {

		targetGeometry.setAttribute( 'normal', createAttributeClone( attributes.normal ) );

	}

	if ( includeTangent && ! targetAttributes.tangent && attributes.tangent ) {

		targetGeometry.setAttribute( 'tangent', createAttributeClone( attributes.tangent ) );

	}

	// ensure the attributes are consistent
	validateAttributes( geometry.index, targetGeometry.index );
	validateAttributes( attributes.position, targetAttributes.position );

	if ( includeNormal ) {

		validateAttributes( attributes.normal, targetAttributes.normal );

	}

	if ( includeTangent ) {

		validateAttributes( attributes.tangent, targetAttributes.tangent );

	}

	// generate transformed vertex attribute data
	const position = attributes.position;
	const normal = includeNormal ? attributes.normal : null;
	const tangent = includeTangent ? attributes.tangent : null;
	const morphPosition = geometry.morphAttributes.position;
	const morphNormal = geometry.morphAttributes.normal;
	const morphTangent = geometry.morphAttributes.tangent;
	const morphTargetsRelative = geometry.morphTargetsRelative;
	const morphInfluences = mesh.morphTargetInfluences;
	const normalMatrix = new Matrix3();
	normalMatrix.getNormalMatrix( mesh.matrixWorld );

	// copy the index
	if ( geometry.index ) {

		targetGeometry.index.array.set( geometry.index.array );

	}

	// copy and apply other attributes
	for ( let i = 0, l = attributes.position.count; i < l; i ++ ) {

		_positionVector.fromBufferAttribute( position, i );
		if ( normal ) {

			_normalVector.fromBufferAttribute( normal, i );

		}

		if ( tangent ) {

			_tangentVector4.fromBufferAttribute( tangent, i );
			_tangentVector.fromBufferAttribute( tangent, i );

		}

		// apply morph target transform
		if ( morphInfluences ) {

			if ( morphPosition ) {

				applyMorphTarget( morphPosition, morphInfluences, morphTargetsRelative, i, _positionVector );

			}

			if ( morphNormal ) {

				applyMorphTarget( morphNormal, morphInfluences, morphTargetsRelative, i, _normalVector );

			}

			if ( morphTangent ) {

				applyMorphTarget( morphTangent, morphInfluences, morphTargetsRelative, i, _tangentVector );

			}

		}

		// apply bone transform
		if ( mesh.isSkinnedMesh ) {

			mesh.applyBoneTransform( i, _positionVector );
			if ( normal ) {

				boneNormalTransform( mesh, i, _normalVector );

			}

			if ( tangent ) {

				boneNormalTransform( mesh, i, _tangentVector );

			}

		}

		// update the vectors of the attributes
		if ( applyWorldTransforms ) {

			_positionVector.applyMatrix4( mesh.matrixWorld );

		}

		targetAttributes.position.setXYZ( i, _positionVector.x, _positionVector.y, _positionVector.z );

		if ( normal ) {

			if ( applyWorldTransforms ) {

				_normalVector.applyNormalMatrix( normalMatrix );

			}

			targetAttributes.normal.setXYZ( i, _normalVector.x, _normalVector.y, _normalVector.z );

		}

		if ( tangent ) {

			if ( applyWorldTransforms ) {

				_tangentVector.transformDirection( mesh.matrixWorld );

			}

			targetAttributes.tangent.setXYZW( i, _tangentVector.x, _tangentVector.y, _tangentVector.z, _tangentVector4.w );

		}

	}

	// copy other attributes over
	for ( const i in options.attributes ) {

		const key = options.attributes[ i ];
		if ( key === 'position' || key === 'tangent' || key === 'normal' || ! ( key in attributes ) ) {

			continue;

		}

		if ( ! targetAttributes[ key ] ) {

			targetGeometry.setAttribute( key, createAttributeClone( attributes[ key ] ) );

		}

		validateAttributes( attributes[ key ], targetAttributes[ key ] );
		copyAttributeContents( attributes[ key ], targetAttributes[ key ] );

	}

	if ( mesh.matrixWorld.determinant() < 0 ) {

		invertGeometry( targetGeometry );

	}

	return targetGeometry;

}
