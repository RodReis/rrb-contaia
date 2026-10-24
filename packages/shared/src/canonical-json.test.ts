import { describe, expect, it } from 'vitest';
import { canonicalizarJson } from './canonical-json';

describe('canonicalizarJson',()=>{
  it('ordena chaves recursivamente sem alterar a ordem de arrays',()=>{
    expect(canonicalizarJson({z:1,a:{y:2,b:3},items:[{z:4,a:5},{b:6}]}))
      .toBe('{"a":{"b":3,"y":2},"items":[{"a":5,"z":4},{"b":6}],"z":1}');
  });
});
