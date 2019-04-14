/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

/**
 * Linear algebra ops.
 */

import {ENGINE} from '../engine';
import {dispose} from '../globals';
import {Tensor, Tensor1D, Tensor2D} from '../tensor';
import {TypedArray} from '../types';
import {assert} from '../util';

import {eye, squeeze, stack, unstack} from './array_ops';
import {split} from './concat_split';
import {norm} from './norm';
import {op} from './operation';
import {sum} from './reduction_ops';
import {tensor2d} from './tensor_ops';

/**
 * Gram-Schmidt orthogonalization.
 *
 * ```js
 * const x = tf.tensor2d([[1, 2], [3, 4]]);
 * let y = tf.linalg.gramSchmidt(x);
 * y.print();
 * console.log('Othogonalized:');
 * y.dot(y.transpose()).print();  // should be nearly the identity matrix.
 * console.log('First row direction maintained:');
 * console.log(y.get(0, 1) / y.get(0, 0));  // should be nearly 2.
 * ```
 *
 * @param xs The vectors to be orthogonalized, in one of the two following
 *   formats:
 *   - An Array of `tf.Tensor1D`.
 *   - A `tf.Tensor2D`, i.e., a matrix, in which case the vectors are the rows
 *     of `xs`.
 *   In each case, all the vectors must have the same length and the length
 *   must be greater than or equal to the number of vectors.
 * @returns The orthogonalized and normalized vectors or matrix.
 *   Orthogonalization means that the vectors or the rows of the matrix
 *   are orthogonal (zero inner products). Normalization means that each
 *   vector or each row of the matrix has an L2 norm that equals `1`.
 */
/**
 * @doc {heading:'Operations',
 *       subheading:'Linear Algebra',
 *       namespace:'linalg'}
 */
function gramSchmidt_(xs: Tensor1D[]|Tensor2D): Tensor1D[]|Tensor2D {
  let inputIsTensor2D: boolean;
  if (Array.isArray(xs)) {
    inputIsTensor2D = false;
    assert(
        xs != null && xs.length > 0,
        () => 'Gram-Schmidt process: input must not be null, undefined, or ' +
            'empty');
    const dim = xs[0].shape[0];
    for (let i = 1; i < xs.length; ++i) {
      assert(
          xs[i].shape[0] === dim,
          () =>
              'Gram-Schmidt: Non-unique lengths found in the input vectors: ' +
              `(${(xs as Tensor1D[])[i].shape[0]} vs. ${dim})`);
    }
  } else {
    inputIsTensor2D = true;
    xs = split(xs, xs.shape[0], 0).map(x => squeeze(x, [0]));
  }

  assert(
      xs.length <= xs[0].shape[0],
      () => `Gram-Schmidt: Number of vectors (${
                (xs as Tensor1D[]).length}) exceeds ` +
          `number of dimensions (${(xs as Tensor1D[])[0].shape[0]}).`);

  const ys: Tensor1D[] = [];
  const xs1d = xs as Tensor1D[];
  for (let i = 0; i < xs.length; ++i) {
    ys.push(ENGINE.tidy(() => {
      let x = xs1d[i];
      if (i > 0) {
        for (let j = 0; j < i; ++j) {
          const proj = sum(ys[j].mulStrict(x)).mul(ys[j]);
          x = x.sub(proj);
        }
      }
      return x.div(norm(x, 'euclidean'));
    }));
  }

  if (inputIsTensor2D) {
    return stack(ys, 0) as Tensor2D;
  } else {
    return ys;
  }
}

/**
 * Computes LU decomposition of a given square tensor
 * Implementation based on Doolittle Decomposition of Matrix
 *  (http://www.engr.colostate.edu/~thompson/hPage/CourseMat/Tutorials/
 *  CompMethods/doolittle.pdf)
 *
 * ```js
 * const x = tf.tensor2d([[1, 2], [3, 4]]);
 * const res = tf.linalg.lu(x);
 * console.log(res.length);
 * const [l, u] = res[0];
 * console.log('L - Lower Triangular Matrix:');
 * l.print();
 * console.log('U - Upper Triangular Matrix:');
 * u.print()
 * l.matMul(u).print()  // Should display a tesor same as x
 * ```
 *
 * @param x `tf.Tensor` that has to be decomposed into a Lower Triangular Matrix
 *   and an Upper Triangualar Matrix such that their product is same as the
 *   original tensor.
 *   `x` must be of rank >= 2 and must be have the two innermost dimension
 *   equal i.e., `x.shape` must be of form `[......., N, N]`.
 * @returns A 2D `Array` with second dimension equal to 2. Each element of the
 *   `Array` is equal to `[l, u]` where l is the lower triangular matrix and u
 *   is the upper triangular both of order `N`, obtained as a result of
 *   decomposition of `NxN` sub tensor.
 *   If the given sub matrix isn't decomposable, the result for `[l, u]` is
 *   `[null, null]`.
 * @throws
 *   - If the rank of `x` is less than 2.
 *   - If `x` doesn't have the two innermost dimension equal.
 */
/**
 * @doc {heading:'Operations',
 *       subheading:'Linear Algebra',
 *       namespace:'linalg'}
 */
function lu_(x: Tensor): Array<[Tensor2D | null, Tensor2D | null]> {
  if (x.rank < 2) {
    throw new Error(
        `lu() requires input tensor of rank >= 2 but found` +
        ` tensor of rank ${x.rank}`);
  } else if (x.shape[x.shape.length - 1] !== x.shape[x.shape.length - 2]) {
    throw new Error(
        `lu() requires the tensor with the two innermost dimension equal` +
        `but found a tensor of dimension ${x.shape}`);
  }

  const xData = x.dataSync();
  const n = x.shape[x.shape.length - 1];
  const totalElements = x.shape.reduce((a, b) => (a * b));
  let res: Array<[Tensor2D, Tensor2D]>;
  res = [];

  for (let i = 0; i < totalElements; i += n * n) {
    const res2d = lu2d(xData.slice(i, i + n * n), n);
    res.push(res2d);
  }

  return res;
}
function lu2d(xData: TypedArray, n: number): [Tensor2D, Tensor2D] {
  return ENGINE.tidy(() => {
    let l: number[];
    let u: number[];
    l = new Array(n * n).fill(0);
    u = new Array(n * n).fill(0);

    for (let i = 0; i < n; ++i) {
      // Evaluating the upper triangular matrix
      for (let k = i; k < n; ++k) {
        u[i * n + k] = xData[i * n + k];
        for (let j = 0; j < i; ++j) {
          u[i * n + k] -= (l[i * n + j] * u[j * n + k]);
        }
      }

      // Evaluating the lower triangular matrix
      for (let k = i; k < n; ++k) {
        if (i === k) {
          l[i * n + i] = 1;
        } else {
          if (u[i * n + i] === 0) {
            return [null, null];
          }

          l[k * n + i] = xData[k * n + i];
          for (let j = 0; j < i; ++j) {
            l[k * n + i] -= (l[k * n + j] * u[j * n + i]);
          }

          l[k * n + i] /= u[i * n + i];
        }
      }
    }
    return [tensor2d(l, [n, n]), tensor2d(u, [n, n])];
  }) as [Tensor2D, Tensor2D];
}

/**
 * Compute QR decomposition of m-by-n matrix using Householder transformation.
 *
 * Implementation based on
 *   [http://www.cs.cornell.edu/~bindel/class/cs6210-f09/lec18.pdf]
 * (http://www.cs.cornell.edu/~bindel/class/cs6210-f09/lec18.pdf)
 *
 * ```js
 * const a = tf.tensor2d([[1, 2], [3, 4]]);
 * let [q, r] = tf.linalg.qr(a);
 * console.log('Q');
 * q.print();
 * console.log('R');
 * r.print();
 * console.log('Orthogonalized');
 * q.dot(q.transpose()).print()  // should be nearly the identity matrix.
 * console.log('Reconstructed');
 * q.dot(r).print(); // should be nearly [[1, 2], [3, 4]];
 * ```
 *
 * @param x The `tf.Tensor` to be QR-decomposed. Must have rank >= 2. Suppose
 *   it has the shape `[..., M, N]`.
 * @param fullMatrices An optional boolean parameter. Defaults to `false`.
 *   If `true`, compute full-sized `Q`. If `false` (the default),
 *   compute only the leading N columns of `Q` and `R`.
 * @returns An `Array` of two `tf.Tensor`s: `[Q, R]`. `Q` is a unitary matrix,
 *   i.e., its columns all have unit norm and are mutually orthogonal.
 *   If `M >= N`,
 *     If `fullMatrices` is `false` (default),
 *       - `Q` has a shape of `[..., M, N]`,
 *       - `R` has a shape of `[..., N, N]`.
 *     If `fullMatrices` is `true` (default),
 *       - `Q` has a shape of `[..., M, M]`,
 *       - `R` has a shape of `[..., M, N]`.
 *   If `M < N`,
 *     - `Q` has a shape of `[..., M, M]`,
 *     - `R` has a shape of `[..., M, N]`.
 * @throws If the rank of `x` is less than 2.
 */
/**
 * @doc {heading:'Operations',
 *       subheading:'Linear Algebra',
 *       namespace:'linalg'}
 */
function qr_(x: Tensor, fullMatrices = false): [Tensor, Tensor] {
  if (x.rank < 2) {
    throw new Error(
        `qr() requires input tensor to have a rank >= 2, but got rank ${
            x.rank}`);
  } else if (x.rank === 2) {
    return qr2d(x as Tensor2D, fullMatrices);
  } else {
    // Rank > 2.
    // TODO(cais): Below we split the input into individual 2D tensors,
    //   perform QR decomposition on them and then stack the results back
    //   together. We should explore whether this can be parallelized.
    const outerDimsProd = x.shape.slice(0, x.shape.length - 2)
                              .reduce((value, prev) => value * prev);
    const x2ds = unstack(
        x.reshape([
          outerDimsProd, x.shape[x.shape.length - 2],
          x.shape[x.shape.length - 1]
        ]),
        0);
    const q2ds: Tensor2D[] = [];
    const r2ds: Tensor2D[] = [];
    x2ds.forEach(x2d => {
      const [q2d, r2d] = qr2d(x2d as Tensor2D, fullMatrices);
      q2ds.push(q2d);
      r2ds.push(r2d);
    });
    const q = stack(q2ds, 0).reshape(x.shape);
    const r = stack(r2ds, 0).reshape(x.shape);
    return [q, r];
  }
}

function qr2d(x: Tensor2D, fullMatrices = false): [Tensor2D, Tensor2D] {
  return ENGINE.tidy(() => {
    if (x.shape.length !== 2) {
      throw new Error(
          `qr2d() requires a 2D Tensor, but got a ${x.shape.length}D Tensor.`);
    }

    const m = x.shape[0];
    const n = x.shape[1];

    let q = eye(m) as Tensor2D;  // Orthogonal transform so far.
    let r = x.clone();           // Transformed matrix so far.

    const one2D = tensor2d([[1]], [1, 1]);
    let w: Tensor2D = one2D.clone();

    const iters = m >= n ? n : m;
    for (let j = 0; j < iters; ++j) {
      // This tidy within the for-loop ensures we clean up temporary
      // tensors as soon as they are no longer needed.
      const rTemp = r;
      const wTemp = w;
      const qTemp = q;
      [w, r, q] = ENGINE.tidy((): [Tensor2D, Tensor2D, Tensor2D] => {
        // Find H = I - tau * w * w', to put zeros below R(j, j).
        const rjEnd1 = r.slice([j, j], [m - j, 1]);
        const normX = rjEnd1.norm();
        const rjj = r.slice([j, j], [1, 1]);
        const s = rjj.sign().neg() as Tensor2D;
        const u1 = rjj.sub(s.mul(normX)) as Tensor2D;
        const wPre = rjEnd1.div(u1);
        if (wPre.shape[0] === 1) {
          w = one2D.clone();
        } else {
          w = one2D.concat(
              wPre.slice([1, 0], [wPre.shape[0] - 1, wPre.shape[1]]) as
                  Tensor2D,
              0);
        }
        const tau = s.matMul(u1).div(normX).neg() as Tensor2D;

        // -- R := HR, Q := QH.
        const rjEndAll = r.slice([j, 0], [m - j, n]);
        const tauTimesW = tau.mul(w) as Tensor2D;
        if (j === 0) {
          r = rjEndAll.sub(tauTimesW.matMul(w.transpose().matMul(rjEndAll)));
        } else {
          r = r.slice([0, 0], [j, n])
                  .concat(
                      rjEndAll.sub(tauTimesW.matMul(
                          w.transpose().matMul(rjEndAll))) as Tensor2D,
                      0) as Tensor2D;
        }
        const qAllJEnd = q.slice([0, j], [m, q.shape[1] - j]);
        if (j === 0) {
          q = qAllJEnd.sub(qAllJEnd.matMul(w).matMul(tauTimesW.transpose()));
        } else {
          q = q.slice([0, 0], [m, j])
                  .concat(
                      qAllJEnd.sub(qAllJEnd.matMul(w).matMul(
                          tauTimesW.transpose())) as Tensor2D,
                      1) as Tensor2D;
        }
        return [w, r, q];
      });
      dispose([rTemp, wTemp, qTemp]);
    }

    if (!fullMatrices && m > n) {
      q = q.slice([0, 0], [m, n]);
      r = r.slice([0, 0], [n, n]);
    }

    return [q, r];
  }) as [Tensor2D, Tensor2D];
}

export const gramSchmidt = op({gramSchmidt_});
export const qr = op({qr_});
export const lu = op({lu_});
