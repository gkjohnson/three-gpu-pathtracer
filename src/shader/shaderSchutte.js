export const shaderSchutte = /* glsl */`

vec3 Schlick(vec3 r0, float radians)
{
	float exponential = pow(1.0f - radians, 5.0);
	return r0 + (vec3(1.0f) - r0) * exponential;
}

float SchlickWeight(float u)
{
	float m = saturate(1.0f - u);
	float m2 = m * m;
	return m * m2 * m2;
}

float Schlick(float r0, float radians)
{
	return mix(1.0f, SchlickWeight(radians), r0);
}





float Clamp( float a, float m1, float m2 ) {

	return min( max( a, m1 ), m2 );

}

float CosTheta(vec3 w)
{
	return w.z;
}

float AbsCosTheta( vec3 v ) {

	return abs( v.z );

}


float Cos2Theta(vec3 w) {
	return CosTheta( w ) * CosTheta( w );
}

float Sin2Theta(vec3 w) {

	return max(0.0, 1.0 - Cos2Theta(w));

}

float SinTheta(vec3 w) {
	return sqrt(Sin2Theta(w));
}


float TanTheta( vec3 v ) {

	return SinTheta( v ) / CosTheta( v );

}

float CosPhi(vec3 w)
{
	float sinTheta = SinTheta(w);
	return (sinTheta == 0.0) ? 1.0 : Clamp(w.x / sinTheta, -1.0, 1.0);
}

float SinPhi(vec3 w)
{
	float sinTheta = SinTheta(w);
	return (sinTheta == 0.0) ? 1.0 : Clamp(w.y / sinTheta, -1.0, 1.0);
}

float Cos2Phi(vec3 w)
{
	float cosPhi = CosPhi(w);
	return cosPhi * cosPhi;
}

float Sin2Phi(vec3 w)
{
	float sinPhi = SinPhi(w);
	return sinPhi * sinPhi;
}



float GTR1( float absDotHL, float a ) {

    if( a >= 1.0 ) {

        return 1.0 / PI;

    }

    float a2 = a * a;
    return ( a2 - 1.0 ) / ( PI * log2( a2 ) * ( 1.0 + ( a2 - 1.0 ) * absDotHL * absDotHL ) );
}

float SeparableSmithGGXG1( vec3 w, float a ) {

    float a2 = a * a;
    float absDotNV = AbsCosTheta( w );
    return 2.0 / ( 1.0 + sqrt( a2 + ( 1.0 - a2 ) * absDotNV * absDotNV ) );

}

float SeparableSmithGGXG1( vec3 w, vec3 wm, float ax, float ay ) {

    float dotHW = dot( w, wm );
    if ( dotHW <= 0.0f ) {

        return 0.0f;

	}

    float absTanTheta = abs( TanTheta( w ) );
    if( isinf( absTanTheta ) ) {

        return 0.0f;

    }

    float a = sqrt( Cos2Phi( w ) * ax * ax + Sin2Phi( w ) * ay * ay );
    float a2Tan2Theta = pow( a * absTanTheta, 2.0 );

    float lambda = 0.5f * ( - 1.0f + sqrt( 1.0f + a2Tan2Theta ) );
    return 1.0f / ( 1.0f + lambda );

}

float GgxAnisotropicD( vec3 wm, float ax, float ay ) {

    float dotHX2 = wm.x * wm.x;
    float dotHY2 = wm.y * wm.y;
    float cos2Theta = Cos2Theta( wm );
    float ax2 = ax * ax;
    float ay2 = ay * ay;

    return 1.0f / ( PI * ax * ay * pow( dotHX2 / ax2 + dotHY2 / ay2 + cos2Theta, 2.0 ) );

}

float EvaluateDisneyClearcoat( float clearcoat, float alpha, vec3 wo, vec3 wm, vec3 wi, out vec3 color ) {

    if( clearcoat <= 0.0f ) {

        return 0.0f;

    }

    float absDotNH = AbsCosTheta( wm );
    float absDotNL = AbsCosTheta( wi );
    float absDotNV = AbsCosTheta( wo );
    float dotHL = dot( wm, wi );

    float d = GTR1(absDotNH, mix( 0.1f, 0.001f, alpha ) );
    float f = Schlick( 0.04f, dotHL );
    float gl = SeparableSmithGGXG1( wi, 0.25f );
    float gv = SeparableSmithGGXG1( wo, 0.25f );

    color = vec3( 0.25f * clearcoat * d * f * gl * gv );
    return d / ( 4.0f * absDotNL );

}
`;
